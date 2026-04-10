const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const { jordanMobileLookupKeys, normalizeOtpDigits } = require('../utils/jordanMobile');
const { getJsonPath } = require('../config/jsonPaths');
const fcm = require('../fcm');
const enrichArhebBoxRow = require('../arhebBox').enrichArhebBoxRow;
const { enrichWithJordanTime } = require('../utils/jordanTime');
const {
  ensureDriverCommissionSettingsTable,
  ensureOrderDriverShareColumns,
  ensureDriverRatingsTable,
  ensureDriverCommissionPercentColumn,
  getDriverDeliveryDefaultPercent,
  normalizeDriverCommissionPercent,
  syncAllDriverRatingsFromTable,
  resolveOrderDriverShare,
  assignDriverToOrder,
  round2,
} = require('../utils/driverCommission');
const { getActiveFromListWithDistance } = require('../driverPresence');

function parseMapsUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const patterns = [
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      const latitude = Number(m[1]);
      const longitude = Number(m[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
    }
  }
  return null;
}

/** Percent change in driver share vs yesterday (same driver, delivered orders). Null if not comparable. */
function earningsGrowthPercentVsYesterday(db, driverId, todayProfitJod, todayDateStr) {
  const parts = String(todayDateStr || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yesterdayStr = dt.toISOString().slice(0, 10);
  const yRows = db
    .prepare('SELECT * FROM orders WHERE driverId = ? AND status = ? AND date(createdAt) = ?')
    .all(driverId, 'Delivered', yesterdayStr);
  const yProfit = sumDriverEarningsForOrders(db, yRows);
  const t = Number(todayProfitJod) || 0;
  if (yProfit > 0) {
    return round2(((t - yProfit) / yProfit) * 100);
  }
  return null;
}

function emitOrderStatus(orderId, status) {
  try {
    const { emitOrderEvent } = require('../order');
    if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status });
  } catch (e) {
    // order module may not be loaded yet
  }
}

function emitBoxStatus(requestId, status) {
  try {
    const { emitArhebBoxEvent } = require('../order');
    if (emitArhebBoxEvent) emitArhebBoxEvent(requestId, 'status_update', { status });
  } catch (e) { /* ignore */ }
}

function loadStores() {
  try {
    const path = getJsonPath('stores_listing_response.json');
    const raw = fs.readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.stores ?? [];
  } catch (e) {
    return [];
  }
}

function sumDriverEarningsForOrders(db, orderRows) {
  return orderRows.reduce((s, o) => {
    const share = resolveOrderDriverShare(db, o);
    const e = share.earningsJod;
    return s + (Number.isFinite(e) ? e : 0);
  }, 0);
}

// Map DB order + items + driver to API shape; optional store adds storeAddress, storeMapsUrl, etc.
// Pass db to include driverShare (commission snapshot + earnings in JOD).
function orderToDriverApi(order, items = [], driverRow = null, store = null, db = null) {
  const address = order.nearby || [order.addressName, order.addressLong, order.addressLat].filter(Boolean).join(', ') || '';
  const driver = driverRow ? {
    id: String(driverRow.id),
    name: driverRow.name,
    photo: driverRow.photo || null,
    mobile: driverRow.mobile,
    vehicleType: driverRow.vehicleType || null,
    vehicleNumber: driverRow.vehicleNumber || null,
    latitude: driverRow.latitude,
    longitude: driverRow.longitude,
    rating: driverRow.rating ?? 5,
  } : null;
  const { orderItemRowToClient } = require('../utils/orderItemApi');
  const productList = (items || []).map((i) => {
    const base = orderItemRowToClient(i);
    return {
      ...base,
      image: null,
      unit: '',
      category: null,
      description: null,
      discount: null,
      stock: null,
      isAvailable: true,
      preparationTime: null,
      ingredients: [],
      allergens: [],
    };
  });
  const numberOfItems = productList.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const clientMapsUrl =
    order.addressLat != null && order.addressLong != null
      ? `https://www.google.com/maps?q=${order.addressLat},${order.addressLong}`
      : (order.addressName || address)
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.addressName || address)}`
        : null;
  const deliveryFeeNum = Math.round(((Number(order.deliveryFee) || 0) + Number.EPSILON) * 100) / 100;
  const createdAt = order.createdAt || null;
  const storeName = store ? store.nameEn || store.name || store.nameAr || null : null;
  const out = {
    id: String(order.id),
    orderNumber: `ORD-${String(order.id).padStart(4, '0')}`,
    storeId: order.storeId != null ? String(order.storeId) : null,
    storeName,
    products: productList,
    totalPrice: order.totalAmount ?? 0,
    deliveryFee: deliveryFeeNum,
    /** Driver earnings (JOD) for this order — same as `driverShare.earningsJod` when commission is resolved. */
    profitJod: null,
    discountAmount: order.discount ?? 0,
    address,
    addressName: order.addressName || null,
    addressLatitude: order.addressLat != null ? Number(order.addressLat) : null,
    addressLongitude: order.addressLong != null ? Number(order.addressLong) : null,
    buildingNumber: null,
    paymentMethod: order.paymentType || 'cash',
    status: mapOrderStatus(order.status),
    orderDate: createdAt,
    createdAt,
    notes: order.notes || null,
    customerName: order.name || null,
    customerPhone: order.phoneNumber || null,
    driverPhone: driverRow?.mobile ?? null,
    driver,
    driver_latitude: driver ? driverRow.latitude : null,
    driver_longitude: driver ? driverRow.longitude : null,
    numberOfItems,
    clientMapsUrl,
    deliveryProofImage: order.deliveryProofImage || null,
  };
  out.storeAddress = store ? store.addressEn || store.address || store.addressAr || null : null;
  out.storeMapsUrl = store ? store.mapsUrl || null : null;
  out.storeLatitude = null;
  out.storeLongitude = null;
  if (store) {
    if (store.latitude != null) out.storeLatitude = Number(store.latitude);
    else if (store.lat != null) out.storeLatitude = Number(store.lat);
    if (store.longitude != null) out.storeLongitude = Number(store.longitude);
    else if (store.long != null) out.storeLongitude = Number(store.long);
    if (out.storeLatitude == null && store.mapsUrl) {
      const parsed = parseMapsUrl(store.mapsUrl);
      if (parsed) { out.storeLatitude = parsed.latitude; out.storeLongitude = parsed.longitude; }
    }
  }
  if (db && order) {
    const share = resolveOrderDriverShare(db, order);
    out.driverShare = {
      commissionType: share.commissionType,
      commissionValue: share.commissionValue,
      earningsJod: share.earningsJod,
    };
    out.profitJod = share.earningsJod;
  }
  return enrichWithJordanTime(out, ['createdAt', 'orderDate']);
}

function mapOrderStatus(s) {
  if (!s) return 'pending';
  const lower = s.toLowerCase();
  if (lower.includes('waiting') || lower.includes('confirmation')) return 'pending';
  if (lower.includes('prepared') || lower.includes('preparing')) return 'ready';
  if (lower.includes('way') || lower.includes('delivering')) return 'delivering';
  if (lower.includes('delivered')) return 'delivered';
  if (lower.includes('cancel')) return 'cancelled';
  return s;
}

const DRIVER_OTP_TTL_MS = 5 * 60 * 1000;

function randomDriverVerificationId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateDriverOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function maskPhoneForLog(phone) {
  const s = String(phone || '').trim();
  if (!s) return '-';
  if (s.length <= 4) return s;
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

module.exports = function attachDriverRoutes(app, db, JWT_SECRET, io = null) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL UNIQUE,
      email TEXT,
      vehicleType TEXT,
      vehicleNumber TEXT,
      licenseNumber TEXT,
      photo TEXT,
      latitude REAL,
      longitude REAL,
      rating REAL DEFAULT 5,
      isVerified INTEGER DEFAULT 0,
      isBlocked INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      deletedAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec(`ALTER TABLE drivers ADD COLUMN isBlocked INTEGER DEFAULT 0`);
  } catch (e) {
    // column exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverId INTEGER`);
  } catch (e) {
    // column exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverName TEXT`);
  } catch (e) {
    // column exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN deliveryProofImage TEXT`);
  } catch (e) {
    // column exists
  }
  try {
    db.exec(`ALTER TABLE drivers ADD COLUMN fcmToken TEXT`);
  } catch (e) {
    // column exists
  }
  try { db.exec(`ALTER TABLE drivers ADD COLUMN deleted INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE drivers ADD COLUMN deletedAt TEXT`); } catch (e) { /* exists */ }

  ensureDriverCommissionSettingsTable(db);
  ensureOrderDriverShareColumns(db);
  ensureDriverRatingsTable(db);
  ensureDriverCommissionPercentColumn(db);
  syncAllDriverRatingsFromTable(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_otp_pending (
      mobile TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      verificationId TEXT NOT NULL,
      expiresAt INTEGER NOT NULL
    )
  `);
  const upsertDriverOtp = db.prepare(`
    INSERT INTO driver_otp_pending (mobile, code, verificationId, expiresAt)
    VALUES (@mobile, @code, @verificationId, @expiresAt)
    ON CONFLICT(mobile) DO UPDATE SET
      code = excluded.code,
      verificationId = excluded.verificationId,
      expiresAt = excluded.expiresAt
  `);
  const getDriverOtpRow = db.prepare('SELECT * FROM driver_otp_pending WHERE mobile = ?');
  const deleteDriverOtpRow = db.prepare('DELETE FROM driver_otp_pending WHERE mobile = ?');

  const findDriverById = db.prepare('SELECT * FROM drivers WHERE id = ?');
  const findDriverByMobile = db.prepare('SELECT * FROM drivers WHERE mobile = ?');

  function findDriverByMobileFlexible(mobile) {
    const keys = jordanMobileLookupKeys(mobile);
    for (const k of keys) {
      const d = findDriverByMobile.get(k);
      if (d && !d.deleted) return d;
    }
    return null;
  }

  function getPendingDriverOtp(canonicalMobile) {
    const row = getDriverOtpRow.get(canonicalMobile);
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      deleteDriverOtpRow.run(canonicalMobile);
      return null;
    }
    return {
      code: row.code,
      verificationId: row.verificationId,
      expiresAt: row.expiresAt,
    };
  }
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
  const updateOrderStatus = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
  let findDriverRequestsByDriver, updateDriverRequestStatus, rejectOtherRequestsForOrder;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS driver_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, orderId INTEGER NOT NULL, driverId INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(orderId, driverId))`);
    findDriverRequestsByDriver = db.prepare('SELECT * FROM driver_requests WHERE driverId = ? AND status = ? ORDER BY createdAt DESC');
    updateDriverRequestStatus = db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId = ?');
    rejectOtherRequestsForOrder = db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId != ?');
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) throw e;
  }

  function driverAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'Missing Authorization header' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (!payload.driverId) {
        return res.status(401).json({ success: false, message: 'Invalid driver token' });
      }
      const driver = findDriverById.get(payload.driverId);
      if (!driver) {
        return res.status(401).json({ success: false, message: 'Driver not found' });
      }
      if (driver.deleted) {
        return res.status(401).json({ success: false, message: 'Driver not found' });
      }
      if (driver.isBlocked) {
        return res.status(403).json({ success: false, message: 'Account is blocked' });
      }
      req.driver = driver;
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
  }

  // POST /api/driver/send-otp
  app.post('/api/driver/send-otp', (req, res) => {
    const { mobile } = req.body || {};
    console.log('driver/send-otp hit', { mobile: maskPhoneForLog(mobile) });
    if (!mobile || !String(mobile).trim()) {
      return res.status(400).json({ success: false, message: 'mobile is required' });
    }
    const driver = findDriverByMobileFlexible(mobile);
    if (!driver || driver.deleted) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found. Contact admin to be added.',
      });
    }
    if (driver.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account is blocked' });
    }
    const code = generateDriverOtpCode();
    const verificationId = randomDriverVerificationId();
    const canonicalMobile = String(driver.mobile).trim();
    const expiresAt = Date.now() + DRIVER_OTP_TTL_MS;
    upsertDriverOtp.run({ mobile: canonicalMobile, code, verificationId, expiresAt });
    if (process.env.DRIVER_OTP_LOG === 'true') {
      console.warn(`[driver OTP] ${canonicalMobile} code=${code} verificationId=${verificationId}`);
    }
    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        verificationId,
        expiresIn: Math.floor(DRIVER_OTP_TTL_MS / 1000),
        mobile: canonicalMobile,
      },
    });
  });

  // POST /api/driver/login
  app.post('/api/driver/login', (req, res) => {
    const { mobile, otpCode, verificationId } = req.body || {};
    console.log('driver/login hit', {
      mobile: maskPhoneForLog(mobile),
      otpLength: String(otpCode ?? '').length,
      hasVerificationId: Boolean(verificationId),
    });
    if (!mobile || otpCode === undefined || otpCode === null || otpCode === '') {
      return res.status(400).json({ success: false, message: 'mobile and otpCode are required' });
    }
    const driver = findDriverByMobileFlexible(mobile);
    if (!driver || driver.deleted) {
      return res.status(401).json({ success: false, message: 'Driver not found. Contact admin to be added.' });
    }
    if (driver.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account is blocked' });
    }
    const canonicalMobile = String(driver.mobile).trim();
    const pending = getPendingDriverOtp(canonicalMobile);
    if (!pending) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired OTP. Request a new code from POST /api/driver/send-otp.',
      });
    }
    if (verificationId && String(verificationId) !== pending.verificationId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid verificationId. Use the value returned by send-otp.',
      });
    }
    const otpNorm = normalizeOtpDigits(otpCode);
    if (otpNorm.length !== 6 || otpNorm !== String(pending.code)) {
      return res.status(401).json({ success: false, message: 'Invalid OTP code' });
    }
    deleteDriverOtpRow.run(canonicalMobile);
    const token = jwt.sign(
      { driverId: driver.id, mobile: driver.mobile },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const d = { ...driver };
    delete d.licenseNumber;
    const defaultPct = getDriverDeliveryDefaultPercent(db);
    const commissionPercent =
      d.commissionPercent != null && Number.isFinite(Number(d.commissionPercent))
        ? Number(d.commissionPercent)
        : defaultPct;
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        driver: {
          id: String(d.id),
          name: d.name,
          photo: d.photo,
          mobile: d.mobile,
          email: d.email,
          vehicleType: d.vehicleType,
          vehicleNumber: d.vehicleNumber,
          latitude: d.latitude,
          longitude: d.longitude,
          rating: d.rating ?? 5,
          isVerified: Boolean(d.isVerified),
          commissionPercent,
        },
        token: `Bearer ${token}`,
        refreshToken: null,
      },
    });
  });

  // GET /api/driver/home
  app.get('/api/driver/home', driverAuth, (req, res) => {
    const driverId = req.driver.id;
    const driverOrders = db.prepare('SELECT * FROM orders WHERE driverId = ? ORDER BY id DESC').all(driverId);
    const currentOrder = driverOrders.find((o) => mapOrderStatus(o.status) === 'delivering');
    const inProgressOrders = driverOrders.filter((o) => mapOrderStatus(o.status) === 'delivering' && o.id !== (currentOrder && currentOrder.id));
    // Available orders for drivers: only unassigned Preparing orders
    const availableOrders = db
      .prepare("SELECT * FROM orders WHERE driverId IS NULL AND status = 'Preparing' ORDER BY id DESC LIMIT 50")
      .all();

    let arhebBoxAvailable = [];
    try {
      const boxAssigned = db.prepare("SELECT * FROM arheb_box_requests WHERE driverId = ? AND LOWER(status) IN ('assigned', 'in_progress') ORDER BY createdAt DESC LIMIT 20").all(driverId);
      const boxConfirmed = db.prepare("SELECT * FROM arheb_box_requests WHERE driverId IS NULL AND LOWER(status) = 'confirmed' ORDER BY createdAt DESC LIMIT 20").all();
      arhebBoxAvailable = [...boxAssigned, ...boxConfirmed].map((r) => enrichArhebBoxRow(r, db));
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString().slice(0, 10);
    const todayOrders = db.prepare('SELECT * FROM orders WHERE driverId = ? AND status = ? AND date(createdAt) = ?').all(driverId, 'Delivered', todayStr);
    const allDelivered = db.prepare('SELECT * FROM orders WHERE driverId = ? AND status = ?').all(driverId, 'Delivered');
    const todayProfit = sumDriverEarningsForOrders(db, todayOrders);
    const totalProfit = sumDriverEarningsForOrders(db, allDelivered);
    const todayDeliveryFees = todayOrders.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
    const totalDeliveryFees = allDelivered.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);

    const defaultPct = getDriverDeliveryDefaultPercent(db);
    const homeCommission =
      req.driver.commissionPercent != null && Number.isFinite(Number(req.driver.commissionPercent))
        ? Number(req.driver.commissionPercent)
        : defaultPct;
    const driverDto = {
      id: String(req.driver.id),
      name: req.driver.name,
      photo: req.driver.photo,
      mobile: req.driver.mobile,
      vehicleType: req.driver.vehicleType,
      vehicleNumber: req.driver.vehicleNumber,
      latitude: req.driver.latitude,
      longitude: req.driver.longitude,
      rating: req.driver.rating ?? 5,
      commissionPercent: homeCommission,
    };
    const stats = {
      todayProfit,
      totalProfit,
      todayDeliveryFees,
      totalDeliveryFees,
      /** @deprecated full delivery fee totals; prefer todayProfit/totalProfit */
      todayEarnings: todayProfit,
      totalEarnings: totalProfit,
      todayOrders: todayOrders.length,
      totalOrders: allDelivered.length,
      rating: req.driver.rating ?? 5,
    };

    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));
    const buildOrder = (order) => {
      const items = findOrderItems.all(order.id);
      const dr = order.driverId ? findDriverById.get(order.driverId) : null;
      const store = order.storeId ? storeById[order.storeId] : null;
      return orderToDriverApi(order, items, dr, store, db);
    };

    return res.status(200).json({
      success: true,
      message: 'Driver home data loaded',
      data: {
        driver: driverDto,
        stats,
        currentOrder: currentOrder ? buildOrder(currentOrder) : null,
        availableOrders: availableOrders.slice(0, 20).map(buildOrder),
        arhebBoxAvailable,
        inProgressOrders: inProgressOrders.map(buildOrder),
      },
    });
  });

  // PATCH /api/driver/fcm — register FCM token when driver is active (for push notifications)
  app.patch('/api/driver/fcm', driverAuth, (req, res) => {
    const { fcmToken } = req.body || {};
    const token = typeof fcmToken === 'string' ? fcmToken.trim() : null;
    db.prepare('UPDATE drivers SET fcmToken = ? WHERE id = ?').run(token || null, req.driver.id);
    return res.status(200).json({
      success: true,
      message: 'FCM token updated',
      data: { updated: true },
    });
  });

  // DELETE /api/driver/account — soft delete driver account (Bearer token)
  app.delete('/api/driver/account', driverAuth, (req, res) => {
    try {
      db.prepare(`UPDATE drivers SET deleted = 1, deletedAt = CURRENT_TIMESTAMP, fcmToken = NULL WHERE id = ?`).run(req.driver.id);
      return res.status(200).json({ success: true, message: 'Account deleted (soft)' });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/driver/stats
  app.get('/api/driver/stats', driverAuth, (req, res) => {
    const driverId = req.driver.id;
    const period = (req.query.period || 'today').toLowerCase();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString().slice(0, 10);
    let orders = [];
    if (period === 'today') {
      orders = db.prepare('SELECT * FROM orders WHERE driverId = ? AND date(createdAt) = ?').all(driverId, todayStr);
    } else {
      orders = db.prepare('SELECT * FROM orders WHERE driverId = ?').all(driverId);
    }
    const completed = orders.filter((o) => mapOrderStatus(o.status) === 'delivered');
    const cancelled = orders.filter((o) => mapOrderStatus(o.status) === 'cancelled');
    const profit = sumDriverEarningsForOrders(db, completed);
    const ratingCount = req.driver.ratingCount != null ? Number(req.driver.ratingCount) : 0;

    let earningsGrowthPercent = null;
    if (period === 'today') {
      earningsGrowthPercent = earningsGrowthPercentVsYesterday(db, driverId, profit, todayStr);
    }

    const defaultPct = getDriverDeliveryDefaultPercent(db);
    const commissionPercent = normalizeDriverCommissionPercent(req.driver.commissionPercent, defaultPct);

    return res.status(200).json({
      success: true,
      message: 'Stats loaded successfully',
      data: {
        period,
        commissionPercent,
        stats: {
          profit,
          earnings: profit,
          earningsGrowthPercent,
          totalOrders: orders.length,
          completedOrders: completed.length,
          cancelledOrders: cancelled.length,
          avgDeliveryTimeMinutes: null,
          rating: req.driver.rating ?? 5,
          totalReviews: ratingCount,
        },
      },
    });
  });

  // GET /api/driver/orders
  app.get('/api/driver/orders', driverAuth, (req, res) => {
    const driverId = req.driver.id;
    const filter = (req.query.filter || 'all').toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 20));
    const offset = (page - 1) * perPage;

    let orders = [];
    if (filter === 'available') {
      // Drivers can only see available orders that are in Preparing status and not yet assigned
      orders = db
        .prepare("SELECT * FROM orders WHERE driverId IS NULL AND status = 'Preparing' ORDER BY id DESC")
        .all();
    } else if (filter === 'in_progress' || filter === 'mine') {
      orders = db.prepare('SELECT * FROM orders WHERE driverId = ? AND status NOT IN (?, ?) ORDER BY id DESC').all(driverId, 'Delivered', 'Cancelled');
    } else {
      orders = db.prepare('SELECT * FROM orders WHERE driverId = ? ORDER BY id DESC').all(driverId);
    }
    const total = orders.length;
    const slice = orders.slice(offset, offset + perPage);
    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));
    const findDriverByIdRun = (id) => (id ? findDriverById.get(id) : null);
    const list = slice.map((o) => {
      const items = findOrderItems.all(o.id);
      const store = o.storeId ? storeById[o.storeId] : null;
      return orderToDriverApi(o, items, findDriverByIdRun(o.driverId), store, db);
    });

    let arhebBoxAvailable = [];
    if (filter === 'available') {
      try {
        const boxAssigned = db.prepare("SELECT * FROM arheb_box_requests WHERE driverId = ? AND LOWER(status) IN ('assigned', 'in_progress') ORDER BY createdAt DESC LIMIT 50").all(driverId);
        const boxConfirmed = db.prepare("SELECT * FROM arheb_box_requests WHERE driverId IS NULL AND LOWER(status) = 'confirmed' ORDER BY createdAt DESC LIMIT 50").all();
        arhebBoxAvailable = [...boxAssigned, ...boxConfirmed].map((r) => enrichArhebBoxRow(r, db));
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }
    }

    const defaultPct = getDriverDeliveryDefaultPercent(db);
    const commissionPercent = normalizeDriverCommissionPercent(req.driver.commissionPercent, defaultPct);

    return res.status(200).json({
      success: true,
      message: 'Orders loaded successfully',
      data: {
        commissionPercent,
        filter,
        page,
        perPage,
        total,
        orders: list,
        ...(filter === 'available' ? { arhebBoxAvailable, arhebBoxAvailableCount: arhebBoxAvailable.length } : {}),
      },
    });
  });

  // GET /api/driver/requests — pending delivery requests (store orders + Arheb Box)
  app.get('/api/driver/requests', driverAuth, (req, res) => {
    if (!findDriverRequestsByDriver) {
      return res.status(200).json({ success: true, data: { requests: [], arhebBoxRequests: [] } });
    }
    const rows = findDriverRequestsByDriver.all(req.driver.id, 'pending');
    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));
    const storeRequests = [];
    const boxRequests = [];
    for (const r of rows) {
      if (r.orderId < 0) {
        const boxId = -r.orderId;
        try {
          const boxRow = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(boxId);
          if (boxRow && boxRow.driverId == null) {
            boxRequests.push({ requestId: r.id, arhebBoxRequestId: boxId, createdAt: r.createdAt, request: enrichArhebBoxRow(boxRow, db) });
          }
        } catch (e) { /* ignore */ }
      } else {
        const order = findOrderById.get(r.orderId);
        if (!order || order.driverId != null) continue;
        const items = findOrderItems.all(r.orderId);
        const store = order.storeId ? storeById[order.storeId] : null;
        storeRequests.push({ requestId: r.id, orderId: r.orderId, createdAt: r.createdAt, order: orderToDriverApi(order, items, null, store, db) });
      }
    }
    return res.status(200).json({
      success: true,
      message: 'Requests loaded',
      data: { requests: storeRequests, arhebBoxRequests: boxRequests },
    });
  });

  // GET /api/driver/orders/assigned — all orders assigned to this driver (same as filter=all; explicit route before :orderId)
  app.get('/api/driver/orders/assigned', driverAuth, (req, res) => {
    const driverId = req.driver.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 20));
    const orders = db.prepare('SELECT * FROM orders WHERE driverId = ? ORDER BY id DESC').all(driverId);
    const total = orders.length;
    const offset = (page - 1) * perPage;
    const slice = orders.slice(offset, offset + perPage);
    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));
    const list = slice.map((o) => {
      const items = findOrderItems.all(o.id);
      const store = o.storeId ? storeById[o.storeId] : null;
      return orderToDriverApi(o, items, findDriverById.get(o.driverId), store, db);
    });
    return res.status(200).json({
      success: true,
      message: 'Assigned orders loaded',
      data: { page, perPage, total, orders: list },
    });
  });

  // GET /api/driver/earnings/today — delivered today only
  app.get('/api/driver/earnings/today', driverAuth, (req, res) => {
    const driverId = req.driver.id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString().slice(0, 10);
    const rows = db
      .prepare('SELECT * FROM orders WHERE driverId = ? AND status = ? AND date(createdAt) = ?')
      .all(driverId, 'Delivered', todayStr);
    const profit = sumDriverEarningsForOrders(db, rows);
    const deliveryFees = rows.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
    return res.status(200).json({
      success: true,
      data: {
        date: todayStr,
        orderCount: rows.length,
        totalDeliveryFees: Math.round((deliveryFees + Number.EPSILON) * 100) / 100,
        totalProfit: profit,
      },
    });
  });

  // GET /api/driver/earnings/summary?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD (inclusive on date(createdAt), delivered only)
  app.get('/api/driver/earnings/summary', driverAuth, (req, res) => {
    const driverId = req.driver.id;
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).slice(0, 10) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo).slice(0, 10) : null;
    let rows = db.prepare('SELECT * FROM orders WHERE driverId = ? AND status = ?').all(driverId, 'Delivered');
    if (dateFrom) {
      rows = rows.filter((o) => String(o.createdAt || '').slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((o) => String(o.createdAt || '').slice(0, 10) <= dateTo);
    }
    const profit = sumDriverEarningsForOrders(db, rows);
    const deliveryFees = rows.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
    return res.status(200).json({
      success: true,
      data: {
        dateFrom,
        dateTo,
        orderCount: rows.length,
        totalDeliveryFees: Math.round((deliveryFees + Number.EPSILON) * 100) / 100,
        totalProfit: profit,
      },
    });
  });

  // GET /api/driver/orders/:orderId
  app.get('/api/driver/orders/:orderId', driverAuth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.driverId !== null && order.driverId !== req.driver.id) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const items = findOrderItems.all(orderId);
    const driverRow = order.driverId ? findDriverById.get(order.driverId) : null;
    const storesList = loadStores();
    const store = order.storeId ? storesList.find((s) => s.id === order.storeId) : null;
    return res.status(200).json({
      success: true,
      message: 'Order loaded successfully',
      data: { order: orderToDriverApi(order, items, driverRow, store, db) },
    });
  });

  // POST /api/driver/orders/accept
  app.post('/api/driver/orders/accept', driverAuth, (req, res) => {
    const { orderId: bodyOrderId, driverId: bodyDriverId } = req.body || {};
    const orderId = parseInt(bodyOrderId || req.body?.orderId, 10);
    const driverId = bodyDriverId != null ? parseInt(bodyDriverId, 10) : req.driver.id;
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'orderId is required' });
    if (driverId !== req.driver.id) return res.status(403).json({ success: false, message: 'You can only accept orders for yourself' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.driverId != null && Number(order.driverId) === Number(driverId)) {
      const updated = findOrderById.get(orderId);
      const items = findOrderItems.all(orderId);
      const driverRow = findDriverById.get(driverId);
      const storesList = loadStores();
      const store = updated.storeId ? storesList.find((s) => s.id === updated.storeId) : null;
      return res.status(200).json({
        success: true,
        message: 'Order already assigned to you',
        data: { order: orderToDriverApi(updated, items, driverRow, store, db) },
      });
    }
    if (order.driverId != null) return res.status(400).json({ success: false, message: 'Order already assigned to another driver' });
    if (updateDriverRequestStatus) {
      const existing = db.prepare('SELECT id FROM driver_requests WHERE orderId = ? AND driverId = ? AND status = ?').get(orderId, driverId, 'pending');
      if (existing) {
        updateDriverRequestStatus.run('accepted', orderId, driverId);
        if (rejectOtherRequestsForOrder) rejectOtherRequestsForOrder.run('rejected', orderId, driverId);
      }
    }
    const driverRowForAccept = findDriverById.get(driverId);
    const driverName = driverRowForAccept ? driverRowForAccept.name : null;
    const currentStatus = order.status || 'Preparing';
    assignDriverToOrder(db, orderId, driverId, driverName, currentStatus);
    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      broadcastDriverOrdersUpdated(io, { type: 'order_accepted', orderId, driverId });
    } catch (e) { /* ignore */ }
    fcm.sendToUserByPhone(
      db,
      order.phoneNumber,
      'Driver assigned',
      `A driver has been assigned to Order #${orderId}.`,
      null,
      {
        orderId: String(orderId),
        status: currentStatus,
        type: 'order_tracking',
        screen: 'order_details',
        deepLink: `arheb://orders/${orderId}`,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      }
    ).catch(() => {});
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    const driverRow = findDriverById.get(driverId);
    const storesList = loadStores();
    const store = updated.storeId ? storesList.find((s) => s.id === updated.storeId) : null;
    return res.status(200).json({
      success: true,
      message: 'Order accepted successfully',
      data: { order: orderToDriverApi(updated, items, driverRow, store, db) },
    });
  });

  // POST /api/driver/orders/:orderId/reject-request — driver rejects a pending delivery request
  app.post('/api/driver/orders/:orderId/reject-request', driverAuth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const driverId = req.driver.id;
    try {
      const existing = db.prepare('SELECT id, status FROM driver_requests WHERE orderId = ? AND driverId = ?').get(orderId, driverId);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'No pending request found for this order' });
      }
      if (existing.status !== 'pending') {
        return res.status(400).json({ success: false, message: `Request already ${existing.status}` });
      }
      db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId = ?').run('rejected', orderId, driverId);
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to reject request' });
    }
    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      broadcastDriverOrdersUpdated(io, { type: 'request_rejected', orderId, driverId });
    } catch (e) { /* ignore */ }
    return res.status(200).json({ success: true, message: 'Request rejected' });
  });

  function completeStoreOrderAsDriver(req, orderId, driverId, res) {
    if (isNaN(orderId)) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }
    if (driverId !== req.driver.id) {
      return res.status(403).json({ success: false, message: 'You can only complete your own orders' });
    }
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.driverId !== driverId) {
      return res.status(403).json({ success: false, message: 'Order not assigned to you. Verify Bearer token and orderId.' });
    }
    const st = (order.status || '').trim();
    if (st === 'Delivered') {
      const items = findOrderItems.all(orderId);
      const driverRow = findDriverById.get(driverId);
      const storesList = loadStores();
      const store = order.storeId ? storesList.find((s) => s.id === order.storeId) : null;
      return res.status(200).json({
        success: true,
        message: 'Order was already delivered',
        data: { order: orderToDriverApi(order, items, driverRow, store, db) },
      });
    }
    if (st !== 'On the way') {
      return res.status(400).json({
        success: false,
        message: 'Order must be On the way before marking delivered. Accept the order first.',
      });
    }
    const body = req.body || {};
    const deliveryProofImage =
      body.deliveryProofImage != null && typeof body.deliveryProofImage === 'string'
        ? body.deliveryProofImage.trim() || null
        : null;
    if (deliveryProofImage) {
      db.prepare('UPDATE orders SET status = ?, deliveryProofImage = ? WHERE id = ?').run('Delivered', deliveryProofImage, orderId);
    } else {
      updateOrderStatus.run('Delivered', orderId);
    }
    emitOrderStatus(orderId, 'Delivered');

    // Notify customer with clickable payload (opens order details in the app).
    fcm.sendToUserByPhone(
      db,
      order.phoneNumber,
      'Order delivered',
      `Order #${orderId} has been delivered. Thank you!`,
      null,
      {
        orderId: String(orderId),
        status: 'Delivered',
        type: 'order_tracking',
        screen: 'order_details',
        deepLink: `arheb://orders/${orderId}`,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      }
    ).catch(() => {});
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    const driverRow = findDriverById.get(driverId);
    const storesList = loadStores();
    const store = updated.storeId ? storesList.find((s) => s.id === updated.storeId) : null;
    return res.status(200).json({
      success: true,
      message: 'Order marked as delivered successfully',
      data: { order: orderToDriverApi(updated, items, driverRow, store, db) },
    });
  }

  // POST /api/driver/orders/:orderId/complete — Bearer token identifies driver; orderId in URL
  app.post('/api/driver/orders/:orderId/complete', driverAuth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    return completeStoreOrderAsDriver(req, orderId, req.driver.id, res);
  });

  // POST /api/driver/orders/complete — body: { orderId } + Bearer
  app.post('/api/driver/orders/complete', driverAuth, (req, res) => {
    const { orderId: bodyOrderId, driverId: bodyDriverId } = req.body || {};
    const orderId = parseInt(bodyOrderId || req.body?.orderId, 10);
    const driverId = bodyDriverId != null ? parseInt(bodyDriverId, 10) : req.driver.id;
    return completeStoreOrderAsDriver(req, orderId, driverId, res);
  });

  // ——— Arheb Box (driver list assigned requests and accept) ———
  app.get('/api/driver/arheb-box', driverAuth, (req, res) => {
    const driverId = req.driver.id;
    let rows = [];
    try {
      rows = db.prepare('SELECT * FROM arheb_box_requests WHERE driverId = ? ORDER BY createdAt DESC').all(driverId);
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const requests = rows.map((r) => enrichArhebBoxRow(r, db));
    return res.status(200).json({ success: true, data: { requests } });
  });

  app.post('/api/driver/arheb-box/:id/accept', driverAuth, (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) return res.status(400).json({ success: false, message: 'Invalid request id' });
    const driverId = req.driver.id;
    let row;
    try {
      row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
    } catch (e) {
      if (e.message && e.message.includes('no such table')) return res.status(404).json({ success: false, message: 'Request not found' });
      throw e;
    }
    if (!row) return res.status(404).json({ success: false, message: 'Request not found' });
    const statusLower = (row.status || '').toLowerCase();

    if (row.driverId != null && row.driverId === driverId) {
      const updated = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
      return res.status(200).json({ success: true, message: 'Already assigned to you', data: { request: enrichArhebBoxRow(updated, db) } });
    }
    if (row.driverId != null && row.driverId !== driverId) {
      return res.status(400).json({ success: false, message: 'Request already assigned to another driver' });
    }

    if (statusLower !== 'assigned' && statusLower !== 'confirmed' && statusLower !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request cannot be accepted in its current state' });
    }

    const driverRow = findDriverById.get(driverId);
    const driverName = driverRow ? driverRow.name : null;
    db.prepare('UPDATE arheb_box_requests SET driverId = ?, driverName = ?, status = ? WHERE id = ?').run(driverId, driverName, 'in_progress', requestId);
    emitBoxStatus(requestId, 'in_progress');

    const pseudoOrderId = -requestId;
    try {
      db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId = ?').run('accepted', pseudoOrderId, driverId);
      db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId != ?').run('rejected', pseudoOrderId, driverId);
    } catch (e) { /* ignore */ }

    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      broadcastDriverOrdersUpdated(io, { type: 'arheb_box_accepted', requestId, driverId });
    } catch (e) { /* ignore */ }

    fcm.sendToToken(row.fcmToken, 'Arheb Box accepted', `A driver has accepted your request #${requestId}.`, null, { type: 'arheb_box_status', requestId: String(requestId), status: 'in_progress' }).catch(() => {});
    if (!row.fcmToken) fcm.sendToUserByPhone(db, row.phoneNumber, 'Arheb Box accepted', `A driver has accepted your request #${requestId}.`, null, { type: 'arheb_box_status', requestId: String(requestId), status: 'in_progress' }).catch(() => {});
    const updated = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
    return res.status(200).json({
      success: true,
      message: 'Arheb Box request accepted',
      data: { request: enrichArhebBoxRow(updated, db) },
    });
  });

  // POST /api/driver/arheb-box/:id/reject-request — driver rejects an Arheb Box request
  app.post('/api/driver/arheb-box/:id/reject-request', driverAuth, (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) return res.status(400).json({ success: false, message: 'Invalid request id' });
    const driverId = req.driver.id;
    const pseudoOrderId = -requestId;
    try {
      const existing = db.prepare('SELECT id, status FROM driver_requests WHERE orderId = ? AND driverId = ?').get(pseudoOrderId, driverId);
      if (!existing) return res.status(404).json({ success: false, message: 'No pending request found for this Arheb Box order' });
      if (existing.status !== 'pending') return res.status(400).json({ success: false, message: `Request already ${existing.status}` });
      db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId = ?').run('rejected', pseudoOrderId, driverId);
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to reject request' });
    }
    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      broadcastDriverOrdersUpdated(io, { type: 'arheb_box_request_rejected', requestId, driverId });
    } catch (e) { /* ignore */ }
    return res.status(200).json({ success: true, message: 'Arheb Box request rejected' });
  });

  // POST /api/driver/arheb-box/:id/complete — Bearer + request id; only assigned driver, status in_progress → delivered
  app.post('/api/driver/arheb-box/:id/complete', driverAuth, (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    const driverId = req.driver.id;
    if (isNaN(requestId)) return res.status(400).json({ success: false, message: 'Invalid request id' });
    let row;
    try {
      row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
    } catch (e) {
      if (e.message && e.message.includes('no such table')) return res.status(404).json({ success: false, message: 'Request not found' });
      throw e;
    }
    if (!row) return res.status(404).json({ success: false, message: 'Arheb Box request not found' });
    if (row.driverId !== driverId) {
      return res.status(403).json({
        success: false,
        message: 'This request is not assigned to you. Verify Bearer token and request id.',
      });
    }
    const statusLower = (row.status || '').toLowerCase();
    if (statusLower === 'delivered') {
      const updated = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
      return res.status(200).json({
        success: true,
        message: 'Arheb Box delivery was already marked complete',
        data: { request: enrichArhebBoxRow(updated, db) },
      });
    }
    if (statusLower !== 'in_progress') {
      return res.status(400).json({
        success: false,
        message: 'Arheb Box request must be in progress (accept the assignment first) before completing.',
      });
    }
    db.prepare('UPDATE arheb_box_requests SET status = ? WHERE id = ?').run('delivered', requestId);
    emitBoxStatus(requestId, 'delivered');
    try {
      const { submitJofotaraInvoiceForArhebBox } = require('../jofotara');
      submitJofotaraInvoiceForArhebBox(db, requestId).catch((e) => {
        console.error(`[jofotara] Async submission failed for arheb box ${requestId}:`, e?.message || e);
      });
    } catch (e) { /* ignore */ }
    fcm.sendToToken(row.fcmToken, 'Arheb Box delivered', `Your request #${requestId} has been delivered.`, null, { type: 'arheb_box_status', requestId: String(requestId), status: 'delivered' }).catch(() => {});
    if (!row.fcmToken) {
      fcm.sendToUserByPhone(db, row.phoneNumber, 'Arheb Box delivered', `Your request #${requestId} has been delivered.`, null, { type: 'arheb_box_status', requestId: String(requestId), status: 'delivered' }).catch(() => {});
    }
    const updated = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
    return res.status(200).json({
      success: true,
      message: 'Arheb Box marked as delivered successfully',
      data: { request: enrichArhebBoxRow(updated, db) },
    });
  });
};
