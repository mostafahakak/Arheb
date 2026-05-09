const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const {
  hashPassword,
  comparePassword,
  signAdminToken,
  verifyAdminToken,
} = require('./auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { seedAdmins, ROLES } = require('./seed');
const {
  authenticateAdmin,
  requireRole,
  requireSuperAdmin,
  requireAdminOrSuper,
  requireStoreAccess,
  requireDashboardAdmin,
} = require('./middleware');
const { ensureActivityLogTable, logActivity, handleActivityLogList } = require('./activityLog');
const { syncCategoriesToDb } = require('../categories');
const { getJsonPath } = require('../config/jsonPaths');
const fcm = require('../fcm');
const { getActiveFromListWithDistance, getActiveDriversWithLocation } = require('../driverPresence');
const enrichArhebBoxRow = require('../arhebBox').enrichArhebBoxRow;
const { getArhebBoxPublicFlags } = require('../arhebBox/flags');
const { mapOrderItemsRows, formatOrderItemAddOnsSummary } = require('../utils/orderItemApi');
const { sanitizeAddOnGroups } = require('../utils/productAddOns');
const {
  isWithinOpeningHours,
  getAdminStoreDashboardBucket,
  sortStoresOpenFirst,
} = require('../utils/storeVisibility');
const {
  mergeStorePaymentMethodsPatch,
  validatePaymentMethodsEnabled,
} = require('../utils/storePaymentMethods');
const {
  enrichStoreOpeningHours,
  normalizeOpeningHoursFromBody,
  parseFlexibleTimeTo24h,
} = require('../utils/openingHoursJordan');
const {
  getDriverCommissionSettings,
  setDriverCommissionSettings,
  resolveOrderDriverShare,
  ensureDriverCommissionSettingsTable,
  ensureOrderDriverShareColumns,
  ensureDriverRatingsTable,
  ensureDriverCommissionPercentColumn,
  parseDriverCommissionPercentForStorage,
  normalizeDriverCommissionPercent,
  getDriverDeliveryDefaultPercent,
  ensureContactUsDriverDeliveryPercentColumn,
  ensureContactUsArhebBoxComingSoonColumn,
  ensureContactUsArhebBoxServiceFeeJodColumn,
  ensureContactUsEinvoicePausedColumn,
  ensureContactUsAppVersionColumns,
  getContactAppVersions,
  selectContactUsLatestRow,
  contactUsEinvoicePausedIsTruthy,
  isEinvoicePaused,
  getArhebBoxServiceFeeJod,
  writeArhebBoxDriverEarningsSnapshot,
  resolveArhebBoxDriverShare,
  assignDriverToOrder,
} = require('../utils/driverCommission');
const { getStoreFcmToken } = require('../storeFcm');
const { enrichWithJordanTime, jordanCalendarDateYmd } = require('../utils/jordanTime');
const { normalizeHomeContentLinkArray } = require('../utils/homeContentLinks');
const {
  parseLatLongFromGoogleMapsUrl,
  notifyDriverDeliveryRequest,
  offerNextSequentialDriver,
  offerNextSequentialArhebBoxDriver,
  countPendingDriverRequests,
  clearStoreOrderOfferTimeout,
  rejectAllPendingDriverRequestsForStoreOrder,
  notifyDriverArhebBoxRequest,
  clearArhebBoxOfferExpansion,
  fcmPayloadForArhebBoxRequest,
} = require('../utils/sequentialDriverOffer');
const {
  runDeliveryClusterAutoAssign,
  ensureOrderAssignmentColumns,
  notifyDriverAssigned,
} = require('../utils/deliveryClusterAssignment');
const { customerArhebBoxTrackingData } = require('../utils/arhebBoxFcm');
const {
  getPlatformCheckoutFeeTiers,
  setPlatformCheckoutFeeTiers,
  ensurePlatformCheckoutFeesTable,
} = require('../utils/platformCheckoutFees');
const {
  listDeliveryFixedZones,
  replaceDeliveryFixedZones,
  seedDeliveryFixedZonesIfEmpty,
} = require('../utils/deliveryFixedZones');
const { round2: round2Money } = require('../utils/deliveryFees');

const storesResponsePath = getJsonPath('stores_listing_response.json');
const productsResponsePath = getJsonPath('products_listing_response.json');
const categoriesResponsePath = getJsonPath('categories_response.json');
const popupJsonPath = getJsonPath('popup.json');
const homeJsonPath = getJsonPath('home_response.json');

function ensureJsonFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf-8');
  }
}

/** Dashboard / JSON may send booleans as strings; `Boolean('false')` is wrongly true. */
function coercePatchBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0' || v === '' || v === null) return false;
  return Boolean(v);
}

function loadStores() {
  try {
    ensureJsonFile(storesResponsePath, { success: true, message: 'Stores listing', data: { stores: [] } });
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.stores ?? [];
  } catch (e) {
    return [];
  }
}

function loadHome() {
  try {
    const raw = fs.readFileSync(homeJsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {
      success: true,
      message: 'Home data retrieved successfully',
      data: {
        banners: [],
        categories: [],
        mostPopularStores: [],
        offers: [],
      },
    };
  }
}

function saveHome(data) {
  const dir = path.dirname(homeJsonPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(homeJsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadProducts() {
  try {
    ensureJsonFile(productsResponsePath, { success: true, message: 'Products listing', data: { products: [] } });
    const raw = fs.readFileSync(productsResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.products ?? [];
  } catch (e) {
    return [];
  }
}

function loadCategories() {
  try {
    ensureJsonFile(categoriesResponsePath, { success: true, message: 'Categories data', data: { categories: [] } });
    const raw = fs.readFileSync(categoriesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.categories ?? [];
  } catch (e) {
    return [];
  }
}

function saveProducts(products) {
  let data;
  try {
    const raw = fs.readFileSync(productsResponsePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    data = { success: true, message: 'Products listing', data: {} };
  }
  data.data = data.data || {};
  data.data.products = products;
  const dir = path.dirname(productsResponsePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(productsResponsePath, JSON.stringify(data, null, 2), 'utf-8');
}

function saveStores(stores) {
  let data;
  try {
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    data = { success: true, message: 'Stores listing', data: {} };
  }
  data.data = data.data || {};
  data.data.stores = stores;
  const dir = path.dirname(storesResponsePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storesResponsePath, JSON.stringify(data, null, 2), 'utf-8');
}

function saveCategories(categories) {
  let data;
  try {
    const raw = fs.readFileSync(categoriesResponsePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    data = { success: true, message: 'Categories data', data: {} };
  }
  data.data = data.data || {};
  data.data.categories = categories;
  const dir = path.dirname(categoriesResponsePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(categoriesResponsePath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadPopup() {
  try {
    const raw = fs.readFileSync(popupJsonPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return { enabled: true, image: '', call_of_action_button: '', destination: '', destination_value: '' };
    }
    if (data.enabled === undefined) data.enabled = true;
    return data;
  } catch (e) {
    return { enabled: true, image: '', call_of_action_button: '', destination: '', destination_value: '' };
  }
}

function savePopup(data) {
  try {
    fs.writeFileSync(popupJsonPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    throw new Error('Failed to save popup');
  }
}

module.exports = function attachAdminRoutes(app, db, JWT_SECRET, io = null) {
  seedAdmins(db);
  ensureActivityLogTable(db);
  ensureOrderAssignmentColumns(db);
  ensurePlatformCheckoutFeesTable(db);

  /** Default: Jordan today→today. Pass allDates=true for no date filter (all time). */
  function resolveOrdersListDateRange(query) {
    const q = query || {};
    const allDates = q.allDates === '1' || q.allDates === 'true';
    if (allDates) return { allDates: true, dateFrom: '', dateTo: '' };
    const today = jordanCalendarDateYmd();
    let df = q.dateFrom ? String(q.dateFrom).trim().slice(0, 10) : '';
    let dt = q.dateTo ? String(q.dateTo).trim().slice(0, 10) : '';
    if (!df && !dt) {
      df = today;
      dt = today;
    } else if (df && !dt) {
      dt = today;
    } else if (!df && dt) {
      df = dt;
    }
    return { allDates: false, dateFrom: df, dateTo: dt };
  }

  function normalizeAdminAppVersionInput(v) {
    if (v === undefined) return undefined;
    const s = String(v ?? '').trim();
    if (s.length > 64) {
      const err = new Error('App version must be at most 64 characters');
      err.code = 'VALIDATION';
      throw err;
    }
    if (/[\r\n<>]/.test(s)) {
      const err = new Error('App version contains invalid characters');
      err.code = 'VALIDATION';
      throw err;
    }
    return s;
  }

  const offerCtx = {
    loadStores,
    getActiveFromListWithDistance,
    parseLatLongFromGoogleMapsUrl,
  };

  function customerOrderTrackingData(orderId, status) {
    return {
      orderId: String(orderId),
      status: String(status || ''),
      type: 'order_tracking',
      screen: 'order_details',
      deepLink: `arheb://orders/${orderId}`,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };
  }

  /** Push + inbox: customer order status (uses order.phoneNumber; FCM resolves Jordan number variants). */
  function notifyCustomerOrderStatusChange(dbConn, orderRow, orderId, nextStatus) {
    if (!dbConn || !orderRow?.phoneNumber) return;
    const key = normalizeOrderStatusKey(nextStatus);
    let title;
    let body;
    switch (key) {
      case 'waiting confirmation':
        title = 'Order update';
        body = `Order #${orderId} is waiting for store confirmation.`;
        break;
      case 'waiting cliq confirmation':
        title = 'Payment update';
        body = `Order #${orderId}: we're confirming your payment.`;
        break;
      case 'preparing':
      case 'being prepared':
        title = 'Preparing your order';
        body = `Order #${orderId} is being prepared.`;
        break;
      case 'on the way':
        title = 'On the way';
        body = `Order #${orderId} is on the way.`;
        break;
      case 'delivered':
        title = 'Delivered';
        body = `Order #${orderId} has been delivered. Thank you!`;
        break;
      case 'cancelled':
        title = 'Order cancelled';
        body = `Order #${orderId} has been cancelled.`;
        break;
      case 'payment rejected':
        title = 'Payment issue';
        body = `Order #${orderId}: payment could not be confirmed.`;
        break;
      default:
        return;
    }
    fcm
      .sendToUserByPhone(dbConn, orderRow.phoneNumber, title, body, null, customerOrderTrackingData(orderId, nextStatus))
      .catch(() => {});
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS store_pause_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        storeId TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('paused', 'unpaused')),
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    // ignore
  }

  const findAdminByEmail = db.prepare('SELECT * FROM admins WHERE email = ?');
  const findAdminById = db.prepare('SELECT * FROM admins WHERE id = ?');
  const findAllAdmins = db.prepare('SELECT id, email, role, storeId, name, createdAt FROM admins ORDER BY id');
  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');

  /** Line items for admin/dashboard: resolves add-on group/option ids to names via product catalog. */
  function mapOrderItemsForAdmin(orderItemRows) {
    const products = loadProducts();
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const findProductById = (id) => byId.get(String(id)) || null;
    return mapOrderItemsRows(orderItemRows, findProductById);
  }

  /** JSON/catalog store ids may be number or string; DB TEXT may differ — compare as strings. */
  function sameStoreId(a, b) {
    return String(a ?? '') === String(b ?? '');
  }

  const auth = authenticateAdmin(JWT_SECRET);

  // ——— Activity log (SuperAdmin / Admin: all; Store Admin: own actions only) ———
  app.get('/api/admin/activity-log', auth, requireDashboardAdmin, (req, res) =>
    handleActivityLogList(db, req, res),
  );

  // ——— Login ———
  app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    const admin = findAdminByEmail.get(email.trim().toLowerCase());
    if (!admin || !comparePassword(password, admin.passwordHash)) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    const token = signAdminToken(
      { adminId: admin.id, email: admin.email, role: admin.role, storeId: admin.storeId || null },
      JWT_SECRET
    );
    return res.status(200).json({
      success: true,
      token: `Bearer ${token}`,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        storeId: admin.storeId || null,
        name: admin.name || null,
      },
    });
  });

  // ——— Me (current admin) ———
  app.get('/api/admin/me', auth, (req, res) => {
    const admin = findAdminById.get(req.admin.adminId);
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });
    return res.status(200).json({
      success: true,
      data: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        storeId: admin.storeId || null,
        name: admin.name || null,
      },
    });
  });

  /** Store Admin / Admin / SuperAdmin: change own password (requires current password). */
  app.patch('/api/admin/me/password', auth, requireDashboardAdmin, (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (currentPassword == null || typeof currentPassword !== 'string' || !String(currentPassword).length) {
        return res.status(400).json({ success: false, message: 'currentPassword is required' });
      }
      if (newPassword == null || typeof newPassword !== 'string' || String(newPassword).length < 8) {
        return res
          .status(400)
          .json({ success: false, message: 'newPassword must be at least 8 characters' });
      }
      const admin = findAdminById.get(req.admin.adminId);
      if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });
      if (!comparePassword(String(currentPassword), admin.passwordHash)) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }
      db.prepare('UPDATE admins SET passwordHash = ? WHERE id = ?').run(hashPassword(String(newPassword)), admin.id);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'admin_account',
        resourceId: String(admin.id),
        storeScopeId: admin.storeId != null ? String(admin.storeId) : null,
        summary: 'Changed own password',
      });
      return res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (e) {
      console.error('Admin change password error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update password' });
    }
  });

  // ——— Admins CRUD (SuperAdmin: all; Admin: cannot create/update/delete SuperAdmin) ———
  app.get('/api/admin/admins', auth, requireAdminOrSuper, (req, res) => {
    const isSuper = req.admin.role === ROLES.SUPERADMIN;
    const rows = findAllAdmins.all();
    const list = isSuper ? rows : rows.filter((r) => r.role !== ROLES.SUPERADMIN);
    return res.status(200).json({ success: true, data: { admins: list } });
  });

  // ——— App users (SuperAdmin / Admin only): list/search, block/unblock, and user orders ———
  app.get('/api/admin/users', auth, requireAdminOrSuper, (req, res) => {
    try {
      const q = (req.query.q || req.query.search || '').toString().trim();
      const withOrderStats =
        req.query.withOrderStats === '1' ||
        req.query.withOrderStats === 'true' ||
        req.query.stats === '1';
      const allTime =
        req.query.allTime === '1' ||
        req.query.allTime === 'true' ||
        req.query.allDates === '1';

      let dateFrom = (req.query.dateFrom || '').toString().trim();
      let dateTo = (req.query.dateTo || '').toString().trim();
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      if (dateFrom && !ymd.test(dateFrom)) dateFrom = '';
      if (dateTo && !ymd.test(dateTo)) dateTo = '';

      const where = ['u.deleted = 0'];
      const whereParams = [];
      if (q) {
        const like = `%${q}%`;
        where.push('(u.phoneNumber LIKE ? OR u.name LIKE ?)');
        whereParams.push(like, like);
      }

      const totalRegisteredUsersRow = db.prepare('SELECT COUNT(*) AS c FROM users WHERE deleted = 0').get();
      const totalRegisteredUsers = Number(totalRegisteredUsersRow?.c ?? 0) || 0;

      let statsLimit = null;
      let statsExcludeZerosApplied = false;

      let rows;
      if (withOrderStats) {
        const joinDateParts = [];
        const joinParams = [];
        if (!allTime && (dateFrom || dateTo)) {
          if (dateFrom) {
            joinDateParts.push('date(o.createdAt) >= date(?)');
            joinParams.push(dateFrom);
          }
          if (dateTo) {
            joinDateParts.push('date(o.createdAt) <= date(?)');
            joinParams.push(dateTo);
          }
        }
        const joinDateSql = joinDateParts.length ? ` AND ${joinDateParts.join(' AND ')}` : '';

        const limitRaw = req.query.limit != null ? parseInt(String(req.query.limit).trim(), 10) : NaN;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : null;

        const includeZeroOrders =
          req.query.includeZeroOrders === '1' ||
          req.query.includeZeroOrders === 'true';
        const excludeZeroOrders =
          limit != null
            ? !includeZeroOrders
            : req.query.excludeZeroOrders === '1' || req.query.excludeZeroOrders === 'true';

        const havingSql =
          excludeZeroOrders ? ' HAVING COUNT(o.id) > 0' : '';

        const limitSql = limit != null ? ' LIMIT ?' : '';
        const limitParams = limit != null ? [limit] : [];

        statsLimit = limit;
        statsExcludeZerosApplied = excludeZeroOrders;

        const sql = `
          SELECT u.phoneNumber, u.userId, u.name, u.addressName, u.createdAt, u.deleted, u.isBlocked,
            COUNT(o.id) AS orderCount,
            ROUND(COALESCE(SUM(
              COALESCE(o.totalAmount, 0) + COALESCE(o.deliveryFee, 0) + COALESCE(o.serviceFee, 0) + COALESCE(o.feesTax, 0)
            ), 0), 2) AS ordersGrandTotalJod
          FROM users u
          LEFT JOIN orders o ON (
            (o.phoneNumber = u.phoneNumber OR o.userId = COALESCE(NULLIF(TRIM(u.userId), ''), u.phoneNumber))
            ${joinDateSql}
          )
          WHERE ${where.join(' AND ')}
          GROUP BY u.phoneNumber${havingSql}
          ORDER BY orderCount DESC, ordersGrandTotalJod DESC, u.createdAt DESC${limitSql}`;
        rows = db.prepare(sql).all(...joinParams, ...whereParams, ...limitParams);
      } else {
        rows = db
          .prepare(
            `SELECT phoneNumber, userId, name, addressName, createdAt, deleted, isBlocked
             FROM users u
             WHERE ${where.join(' AND ').replace(/u\./g, '')}
             ORDER BY createdAt DESC`
          )
          .all(...whereParams);
      }

      const users = rows.map((u) => {
        const base = {
          phoneNumber: u.phoneNumber,
          userId: u.userId || u.phoneNumber,
          name: u.name || '',
          addressName: u.addressName || '',
          isBlocked: Boolean(u.isBlocked),
          createdAt: u.createdAt,
        };
        if (withOrderStats) {
          base.orderCount = Number(u.orderCount) || 0;
          base.ordersGrandTotalJod = Number(u.ordersGrandTotalJod) || 0;
        }
        return base;
      });
      const meta = {
        totalRegisteredUsers,
        withOrderStats,
        ...(withOrderStats
          ? {
              allTime,
              dateFrom: allTime ? null : dateFrom || null,
              dateTo: allTime ? null : dateTo || null,
              limit: statsLimit,
              excludeZeroOrders: statsExcludeZerosApplied,
            }
          : {}),
      };
      return res.status(200).json({ success: true, data: { users, meta } });
    } catch (e) {
      console.error('Admin users list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list users' });
    }
  });

  app.patch('/api/admin/users/:phone/block', auth, requireAdminOrSuper, (req, res) => {
    try {
      const phone = String(req.params.phone || '').trim();
      if (!phone) return res.status(400).json({ success: false, message: 'Invalid phone' });
      const user = findUserByPhone.get(phone);
      if (!user || user.deleted) return res.status(404).json({ success: false, message: 'User not found' });
      const blocked = req.body?.isBlocked === true;
      db.prepare('UPDATE users SET isBlocked = ? WHERE phoneNumber = ?').run(blocked ? 1 : 0, phone);
      const updated = findUserByPhone.get(phone);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'user',
        resourceId: phone,
        storeScopeId: null,
        summary: `${blocked ? 'Blocked' : 'Unblocked'} user ${phone}`,
      });
      return res.status(200).json({
        success: true,
        data: {
          user: {
            phoneNumber: updated.phoneNumber,
            userId: updated.userId || updated.phoneNumber,
            name: updated.name || '',
            isBlocked: Boolean(updated.isBlocked),
            createdAt: updated.createdAt,
          },
        },
      });
    } catch (e) {
      console.error('Admin user block error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update user status' });
    }
  });

  app.get('/api/admin/users/:phone/orders', auth, requireAdminOrSuper, (req, res) => {
    try {
      const phone = String(req.params.phone || '').trim();
      if (!phone) return res.status(400).json({ success: false, message: 'Invalid phone' });
      const user = findUserByPhone.get(phone);
      if (!user || user.deleted) return res.status(404).json({ success: false, message: 'User not found' });

      const orders = db
        .prepare('SELECT * FROM orders WHERE phoneNumber = ? OR userId = ? ORDER BY createdAt DESC, id DESC')
        .all(phone, user.userId || phone);
      const storesList = loadStores();
      const storeById = Object.fromEntries(storesList.map((s) => [String(s.id), s]));
      const ordersOut = orders.map((o) => {
        const items = findOrderItems.all(o.id);
        const store = o.storeId != null ? storeById[String(o.storeId)] : null;
        return {
          ...o,
          storeName: store ? (store.nameEn || store.name || store.nameAr) : (o.storeId || '-'),
          items: mapOrderItemsForAdmin(items),
        };
      });
      return res.status(200).json({
        success: true,
        data: {
          user: {
            phoneNumber: user.phoneNumber,
            userId: user.userId || user.phoneNumber,
            name: user.name || '',
            isBlocked: Boolean(user.isBlocked),
          },
          orders: ordersOut,
        },
      });
    } catch (e) {
      console.error('Admin user orders error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load user orders' });
    }
  });

  /** Full customer profile: user, orders, Arheb Box, top stores, delivery locations. */
  app.get('/api/admin/customers/:phone/profile', auth, requireAdminOrSuper, (req, res) => {
    try {
      const phone = decodeURIComponent(String(req.params.phone || '').trim());
      if (!phone) return res.status(400).json({ success: false, message: 'Invalid phone' });
      const user = findUserByPhone.get(phone);
      if (!user || user.deleted) return res.status(404).json({ success: false, message: 'User not found' });
      const uid = user.userId || phone;
      const orders = db
        .prepare('SELECT * FROM orders WHERE phoneNumber = ? OR userId = ? ORDER BY createdAt DESC, id DESC')
        .all(phone, uid);
      let boxRows = [];
      try {
        boxRows = db
          .prepare('SELECT * FROM arheb_box_requests WHERE phoneNumber = ? ORDER BY createdAt DESC, id DESC')
          .all(phone);
      } catch (e) {
        boxRows = [];
      }
      const storesList = loadStores();
      const storeById = Object.fromEntries(storesList.map((s) => [String(s.id), s]));
      const storeOrderCount = {};
      let storeOrdersSubtotalSum = 0;
      const locationKeys = new Set();
      const locations = [];
      const ordersOut = orders.map((o) => {
        const items = findOrderItems.all(o.id);
        const store = o.storeId != null ? storeById[String(o.storeId)] : null;
        if (o.storeId) {
          const sid = String(o.storeId);
          storeOrderCount[sid] = (storeOrderCount[sid] || 0) + 1;
        }
        storeOrdersSubtotalSum += Number(o.totalAmount) || 0;
        const locKey = `${o.addressLat ?? ''}|${o.addressLong ?? ''}|${(o.addressName || '').slice(0, 120)}`;
        if (!locationKeys.has(locKey) && (o.addressName || o.addressLat != null)) {
          locationKeys.add(locKey);
          locations.push({
            addressName: o.addressName || '',
            addressLat: o.addressLat,
            addressLong: o.addressLong,
          });
        }
        return {
          ...o,
          orderType: 'store',
          storeName: store ? (store.nameEn || store.name || store.nameAr) : (o.storeId || '-'),
          items: mapOrderItemsForAdmin(items),
        };
      });
      const topStores = Object.entries(storeOrderCount)
        .map(([storeId, count]) => ({
          storeId,
          orderCount: count,
          storeName: storeById[storeId] ? (storeById[storeId].nameEn || storeById[storeId].name || storeId) : storeId,
        }))
        .sort((a, b) => b.orderCount - a.orderCount);
      const boxOut = boxRows.map((r) => enrichArhebBoxRow(r, db));
      return res.status(200).json({
        success: true,
        data: {
          user: {
            phoneNumber: user.phoneNumber,
            userId: uid,
            name: user.name || '',
            addressName: user.addressName || '',
            isBlocked: Boolean(user.isBlocked),
            createdAt: user.createdAt,
          },
          stats: {
            storeOrderCount: orders.length,
            arhebBoxCount: boxRows.length,
            storeOrdersSubtotalSumJod: round2Money(storeOrdersSubtotalSum),
          },
          topStores,
          deliveryLocations: locations,
          orders: ordersOut,
          arhebBoxRequests: boxOut,
        },
      });
    } catch (e) {
      console.error('Customer profile error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load customer profile' });
    }
  });

  app.post('/api/admin/admins', auth, requireAdminOrSuper, (req, res) => {
    const { email, password, role, storeId, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    if (role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Only SuperAdmin can create SuperAdmin' });
    }
    const allowedRoles = req.admin.role === ROLES.SUPERADMIN
      ? [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.STORE_ADMIN]
      : [ROLES.ADMIN, ROLES.STORE_ADMIN];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    if (role === ROLES.STORE_ADMIN && !storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required for store_admin' });
    }
    const insert = db.prepare(
      'INSERT INTO admins (email, passwordHash, role, storeId, name) VALUES (?, ?, ?, ?, ?)'
    );
    try {
      insert.run(
        email.trim().toLowerCase(),
        hashPassword(password),
        role,
        role === ROLES.STORE_ADMIN ? String(storeId) : null,
        name || null
      );
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(400).json({ success: false, message: 'Email already exists' });
      }
      throw e;
    }
    const created = findAdminByEmail.get(email.trim().toLowerCase());
    logActivity(db, req, {
      action: 'add',
      resourceType: 'admin_user',
      resourceId: String(created.id),
      storeScopeId: created.storeId != null ? String(created.storeId) : null,
      summary: `Created admin ${created.email} (${created.role})`,
    });
    return res.status(201).json({
      success: true,
      data: {
        id: created.id,
        email: created.email,
        role: created.role,
        storeId: created.storeId || null,
        name: created.name || null,
        createdAt: created.createdAt,
      },
    });
  });

  app.patch('/api/admin/admins/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const target = findAdminById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Admin not found' });
    if (target.role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Cannot edit SuperAdmin' });
    }
    const { email, password, role, storeId, name } = req.body || {};
    const updates = [];
    const values = [];
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email.trim().toLowerCase());
    }
    if (password !== undefined && password !== '') {
      updates.push('passwordHash = ?');
      values.push(hashPassword(password));
    }
    if (role !== undefined) {
      if (target.role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
        return res.status(403).json({ success: false, message: 'Cannot change SuperAdmin role' });
      }
      if (role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin can set SuperAdmin role' });
      }
      updates.push('role = ?');
      values.push(role);
      updates.push('storeId = ?');
      values.push(role === ROLES.STORE_ADMIN ? (storeId != null ? String(storeId) : target.storeId) : null);
    } else if (storeId !== undefined) {
      updates.push('storeId = ?');
      values.push(target.role === ROLES.STORE_ADMIN ? String(storeId) : null);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name || null);
    }
    if (updates.length === 0) {
      return res.status(200).json({ success: true, data: target });
    }
    values.push(id);
    db.prepare(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const updated = findAdminById.get(id);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'admin_user',
      resourceId: String(updated.id),
      storeScopeId: updated.storeId != null ? String(updated.storeId) : null,
      summary: `Updated admin ${updated.email}`,
    });
    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        storeId: updated.storeId || null,
        name: updated.name || null,
        createdAt: updated.createdAt,
      },
    });
  });

  app.delete('/api/admin/admins/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (id === req.admin.adminId) {
      return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }
    const target = findAdminById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Admin not found' });
    if (target.role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Cannot delete SuperAdmin' });
    }
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'admin_user',
      resourceId: String(id),
      storeScopeId: target.storeId != null ? String(target.storeId) : null,
      summary: `Deleted admin ${target.email}`,
    });
    db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    return res.status(200).json({ success: true, message: 'Admin deleted' });
  });

  // ——— Stores ———
  app.get('/api/admin/stores', auth, (req, res) => {
    const stores = loadStores();
    let list =
      req.admin.role === ROLES.STORE_ADMIN
        ? stores.filter((s) => String(s.id) === String(req.admin.storeId))
        : [...stores];

    const bucket = (s) => getAdminStoreDashboardBucket(s);
    const counts = { open: 0, paused: 0, closed: 0, total: list.length };
    for (const s of list) {
      counts[bucket(s)]++;
    }

    const isAdminOrSuper = req.admin.role === ROLES.ADMIN || req.admin.role === ROLES.SUPERADMIN;
    const statusParam = String(req.query.status || '')
      .trim()
      .toLowerCase();
    const pausedParam = req.query.paused;
    const isOpenParam = req.query.isOpen;

    let appliedFilter = { mode: 'all' };

    if (isAdminOrSuper) {
      if (statusParam === 'open' || statusParam === 'paused' || statusParam === 'closed') {
        list = list.filter((s) => bucket(s) === statusParam);
        appliedFilter = { mode: 'status', status: statusParam };
      } else if (pausedParam === 'true') {
        list = list.filter((s) => s.paused === true);
        appliedFilter = { mode: 'status', status: 'paused' };
      } else if (isOpenParam === 'true' || isOpenParam === 'false') {
        const wantOpen = isOpenParam === 'true';
        list = list.filter((s) => {
          if (s.paused === true || s.blocked === true) return false;
          const withinHours = isWithinOpeningHours(s);
          const effectivelyOpen = s.isOpen !== false && withinHours;
          return wantOpen ? effectivelyOpen : !effectivelyOpen;
        });
        appliedFilter = { mode: 'legacyIsOpen', isOpen: wantOpen };
      }
    }

    const bucketOrder = { open: 0, paused: 1, closed: 2 };
    const tierWeight = (s) => (s.isExclusive === true ? 0 : s.isPremium === true ? 1 : 2);
    list.sort((a, b) => {
      const da = typeof a.displayOrder === 'number' ? a.displayOrder : Infinity;
      const db_ = typeof b.displayOrder === 'number' ? b.displayOrder : Infinity;
      if (da !== db_) return da - db_;
      const ta = tierWeight(a);
      const tb = tierWeight(b);
      if (ta !== tb) return ta - tb;
      const ba = bucket(a);
      const bb = bucket(b);
      if (bucketOrder[ba] !== bucketOrder[bb]) return bucketOrder[ba] - bucketOrder[bb];
      const na = String(a.name ?? a.nameEn ?? a.id ?? '');
      const nb = String(b.name ?? b.nameEn ?? b.id ?? '');
      return na.localeCompare(nb, undefined, { sensitivity: 'base' });
    });

    const { isStoreAdminOnline } = require('../merchantPresence');
    const mapStore = (s) => {
      const dashboardStatus = bucket(s);
      const base =
        req.admin.role !== ROLES.SUPERADMIN
          ? (() => {
              const { arhebFee, ...rest } = s;
              return rest;
            })()
          : { ...s };
      const fcmToken = getStoreFcmToken(db, s.id) ?? null;
      return {
        ...enrichStoreOpeningHours(base),
        dashboardStatus,
        fcmToken,
        isExclusive: base.isExclusive === true,
        isPremium: base.isPremium === true,
        hiddenFromCustomers: base.hiddenFromCustomers === true,
        merchantOnline: isStoreAdminOnline(s.id),
      };
    };

    return res.status(200).json({
      success: true,
      data: {
        stores: list.map(mapStore),
        counts,
        filter: appliedFilter,
      },
    });
  });

  // ——— Pause history: store admin sees their store (default today); Admin/SuperAdmin all stores or filter by storeIds + date range ———
  app.get('/api/admin/stores/pause-history', auth, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    let dateFrom = (req.query.dateFrom || today).toString().trim();
    let dateTo = (req.query.dateTo || today).toString().trim();
    if (!dateFrom) dateFrom = today;
    if (!dateTo) dateTo = today;
    const rangeStart = dateFrom + ' 00:00:00';
    const rangeEnd = dateTo + ' 23:59:59';
    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));

    let storeIds = [];
    if (req.admin.role === ROLES.STORE_ADMIN) {
      storeIds = req.admin.storeId ? [String(req.admin.storeId)] : [];
    } else {
      const raw = req.query.storeIds || req.query.storeId;
      if (raw) {
        storeIds = (Array.isArray(raw) ? raw : String(raw).split(',')).map((s) => String(s).trim()).filter(Boolean);
      } else {
        storeIds = storesList.map((s) => String(s.id));
      }
    }

    if (storeIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { dateFrom, dateTo, stores: [], totalDurationMinutes: 0 },
      });
    }

    const placeholders = storeIds.map(() => '?').join(',');
    const getEventsInRange = db.prepare(
      `SELECT * FROM store_pause_events WHERE storeId IN (${placeholders}) AND createdAt >= ? AND createdAt <= ? ORDER BY storeId, createdAt`
    );
    const getLastBefore = db.prepare(
      'SELECT * FROM store_pause_events WHERE storeId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT 1'
    );

    const allEventsInRange = getEventsInRange.all(...storeIds, rangeStart, rangeEnd);
    const eventsByStore = {};
    for (const e of allEventsInRange) {
      const sid = String(e.storeId);
      if (!eventsByStore[sid]) eventsByStore[sid] = [];
      eventsByStore[sid].push(e);
    }

    function buildSessionsForStore(storeId, events, prevEvent) {
      const sessions = [];
      let totalMinutes = 0;
      let openPausedAt = null;
      if (prevEvent && prevEvent.action === 'paused') {
        openPausedAt = rangeStart;
      }
      for (const ev of events) {
        if (ev.action === 'paused') {
          if (openPausedAt) {
            const start = new Date(openPausedAt).getTime();
            const end = new Date(ev.createdAt).getTime();
            const durationMinutes = Math.round((end - start) / 60000);
            sessions.push({ pausedAt: openPausedAt, unpausedAt: ev.createdAt, durationMinutes });
            totalMinutes += durationMinutes;
          }
          openPausedAt = ev.createdAt;
        } else {
          if (openPausedAt) {
            const start = new Date(openPausedAt).getTime();
            const end = new Date(ev.createdAt).getTime();
            const durationMinutes = Math.round((end - start) / 60000);
            sessions.push({ pausedAt: openPausedAt, unpausedAt: ev.createdAt, durationMinutes });
            totalMinutes += durationMinutes;
          }
          openPausedAt = null;
        }
      }
      if (openPausedAt) {
        const endMs = Math.min(new Date(rangeEnd).getTime(), Date.now());
        const startMs = new Date(openPausedAt).getTime();
        const durationMinutes = Math.round((endMs - startMs) / 60000);
        sessions.push({ pausedAt: openPausedAt, unpausedAt: null, durationMinutes });
        totalMinutes += durationMinutes;
      }
      return { sessions, totalMinutes };
    }

    const storesResult = [];
    let grandTotalMinutes = 0;
    for (const storeId of storeIds) {
      const events = eventsByStore[storeId] || [];
      const prevRow = getLastBefore.get(storeId, rangeStart);
      const { sessions, totalMinutes } = buildSessionsForStore(storeId, events, prevRow || null);
      const store = storeById[storeId];
      storesResult.push({
        storeId,
        storeName: store ? (store.nameEn || store.name || store.nameAr) : storeId,
        sessions,
        totalDurationMinutes: totalMinutes,
      });
      grandTotalMinutes += totalMinutes;
    }

    return res.status(200).json({
      success: true,
      data: {
        dateFrom,
        dateTo,
        stores: storesResult,
        totalDurationMinutes: grandTotalMinutes,
      },
    });
  });

  app.post('/api/admin/stores', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const stores = loadStores();
    const ids = stores.map((s) => parseInt(String(s.id), 10)).filter((n) => !isNaN(n));
    const nextId = ids.length ? String(Math.max(...ids) + 1) : '1';
    const rawOpening =
      body.openingHours && typeof body.openingHours === 'object'
        ? body.openingHours
        : {
            open: body.openingHoursOpen ?? '09:00',
            ...(body.openingHoursClose != null && String(body.openingHoursClose).trim() !== ''
              ? { close: body.openingHoursClose }
              : {}),
            openMeridiem: body.openingHoursOpenMeridiem,
            closeMeridiem: body.openingHoursCloseMeridiem,
          };
    const normalizedHours = normalizeOpeningHoursFromBody(rawOpening, null);
    const openingHours = normalizedHours.openingHours;
    const closingTimeResolved = normalizedHours.closingTime ?? body.closingTime ?? null;
    const newStore = {
      id: nextId,
      name: body.name ?? body.nameEn ?? body.nameAr ?? '',
      nameAr: body.nameAr ?? body.name ?? '',
      nameEn: body.nameEn ?? body.name ?? '',
      cover: body.cover ?? '',
      logo: body.logo ?? '',
      rate: typeof body.rate === 'number' ? body.rate : 4,
      numberOfReviews: body.numberOfReviews ?? 0,
      isFavorite: false,
      deliveryTime: body.deliveryTime ?? '30-45 min',
      deliveryFee: typeof body.deliveryFee === 'number' ? body.deliveryFee : parseFloat(body.deliveryFee) || 0,
      minimumOrder: typeof body.minimumOrder === 'number' ? body.minimumOrder : parseFloat(body.minimumOrder) || 0,
      isOpen: body.isOpen !== false,
      openingHours,
      address: body.address ?? body.addressEn ?? '',
      addressAr: body.addressAr ?? body.address ?? '',
      addressEn: body.addressEn ?? body.address ?? '',
      phone: body.phone ?? '',
      category: body.category ?? 'restaurants',
      categoryAr: body.categoryAr ?? body.category ?? '',
      categoryEn: body.categoryEn ?? body.category ?? '',
      subCategories: Array.isArray(body.subCategories) ? body.subCategories : [],
      isPremium: body.isPremium === true,
      isExclusive: body.isExclusive === true,
      mapsUrl: body.mapsUrl ?? '',
      closingTime: closingTimeResolved,
      arhebFee: req.admin.role === ROLES.SUPERADMIN && body.arhebFee != null ? (typeof body.arhebFee === 'number' ? body.arhebFee : parseFloat(body.arhebFee)) : null,
      storeCategories: Array.isArray(body.storeCategories) ? body.storeCategories : [],
      paused: false,
      blocked: false,
    };
    if (body.paymentMethods !== undefined && body.paymentMethods !== null && typeof body.paymentMethods === 'object') {
      const merged = mergeStorePaymentMethodsPatch({}, body.paymentMethods);
      const v = validatePaymentMethodsEnabled(merged);
      if (!v.ok) {
        return res.status(400).json({ success: false, message: v.message });
      }
      newStore.paymentMethods = merged;
    }
    stores.push(newStore);
    saveStores(stores);
    try {
      const insertStoreListing = db.prepare(`
        INSERT INTO store_listings (id, name, nameAr, nameEn, cover, logo, rate, numberOfReviews, isFavorite, deliveryTime, deliveryFee, minimumOrder, isOpen, openingHoursOpen, openingHoursClose, address, addressAr, addressEn, phone, category, categoryAr, categoryEn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStoreListing.run(
        newStore.id,
        newStore.name ?? null,
        newStore.nameAr ?? null,
        newStore.nameEn ?? null,
        newStore.cover ?? null,
        newStore.logo ?? null,
        newStore.rate ?? null,
        newStore.numberOfReviews ?? null,
        0,
        newStore.deliveryTime ?? null,
        newStore.deliveryFee ?? null,
        newStore.minimumOrder ?? null,
        newStore.isOpen ? 1 : 0,
        newStore.openingHours?.open ?? null,
        newStore.openingHours?.close ?? null,
        newStore.address ?? null,
        newStore.addressAr ?? null,
        newStore.addressEn ?? null,
        newStore.phone ?? null,
        newStore.category ?? null,
        newStore.categoryAr ?? null,
        newStore.categoryEn ?? null
      );
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    logActivity(db, req, {
      action: 'add',
      resourceType: 'store',
      resourceId: String(newStore.id),
      storeScopeId: String(newStore.id),
      summary: `Created store ${newStore.nameEn || newStore.name || newStore.id}`,
    });
    return res.status(201).json({
      success: true,
      data: { store: enrichStoreOpeningHours({ ...newStore }) },
    });
  });

  app.get('/api/admin/stores/:id', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const stores = loadStores();
    const store = stores.find((s) => String(s.id) === String(req.params.id));
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    let out = req.admin.role === ROLES.SUPERADMIN ? { ...store } : (() => { const { arhebFee, ...rest } = store; return rest; })();
    out.storeCategories = Array.isArray(out.storeCategories) ? out.storeCategories : [];
    out = enrichStoreOpeningHours(out);
    out.fcmToken = getStoreFcmToken(db, store.id) ?? null;
    return res.status(200).json({ success: true, data: { store: out } });
  });

  app.patch('/api/admin/stores/:id', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const stores = loadStores();
    const idx = stores.findIndex((s) => String(s.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, message: 'Store not found' });
    const store = stores[idx];
    if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can make changes.' });
    }
    const allowed = ['name', 'nameAr', 'nameEn', 'cover', 'logo', 'deliveryTime', 'deliveryFee', 'minimumOrder', 'isOpen', 'openingHours', 'address', 'addressAr', 'addressEn', 'phone', 'category', 'categoryAr', 'categoryEn', 'subCategories', 'mapsUrl', 'closingTime'];
    const body = req.body || {};
    if (body.subCategories !== undefined) {
      stores[idx].subCategories = Array.isArray(body.subCategories) ? body.subCategories : [];
    }
    if (body.storeCategories !== undefined) {
      stores[idx].storeCategories = Array.isArray(body.storeCategories) ? body.storeCategories : [];
    }
    if (body.isPremium !== undefined) {
      if (req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin or Admin can set premium' });
      }
      stores[idx].isPremium = Boolean(body.isPremium);
    }
    if (body.isExclusive !== undefined) {
      if (req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin or Admin can set exclusive' });
      }
      stores[idx].isExclusive = Boolean(body.isExclusive);
    }
    if (body.displayOrder !== undefined) {
      if (req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Only Admin or SuperAdmin can set display order' });
      }
      stores[idx].displayOrder = body.displayOrder === null || body.displayOrder === '' ? undefined : Number(body.displayOrder);
    }
    if (body.hiddenFromCustomers !== undefined) {
      if (req.admin.role !== ROLES.SUPERADMIN && req.admin.role !== ROLES.ADMIN) {
        return res.status(403).json({ success: false, message: 'Only Admin or SuperAdmin can hide a store from customers' });
      }
      stores[idx].hiddenFromCustomers = Boolean(body.hiddenFromCustomers);
    }
    if (body.arhebFee !== undefined) {
      if (req.admin.role !== ROLES.SUPERADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin can set arhebFee' });
      }
      stores[idx].arhebFee = body.arhebFee === null || body.arhebFee === '' ? null : (typeof body.arhebFee === 'number' ? body.arhebFee : parseFloat(body.arhebFee));
    }
    if (body.paused !== undefined) {
      if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Store is blocked' });
      }
      stores[idx].paused = Boolean(body.paused);
      try {
        db.prepare('INSERT INTO store_pause_events (storeId, action) VALUES (?, ?)').run(req.params.id, body.paused ? 'paused' : 'unpaused');
      } catch (e) {
        // table may not exist in old deployments; ignore
      }
    }
    if (body.blocked !== undefined) {
      if (req.admin.role !== ROLES.SUPERADMIN && req.admin.role !== ROLES.ADMIN) {
        return res.status(403).json({ success: false, message: 'Only Admin or SuperAdmin can block or unblock a store' });
      }
      stores[idx].blocked = Boolean(body.blocked);
    }
    if (
      req.admin.role === ROLES.SUPERADMIN ||
      req.admin.role === ROLES.ADMIN ||
      req.admin.role === ROLES.STORE_ADMIN
    ) {
      if (body.checkoutDeliveryFeeZero !== undefined) {
        stores[idx].checkoutDeliveryFeeZero = coercePatchBoolean(body.checkoutDeliveryFeeZero);
      }
      if (body.checkoutServiceFeeDisabled !== undefined) {
        stores[idx].checkoutServiceFeeDisabled = coercePatchBoolean(body.checkoutServiceFeeDisabled);
      }
      if (body.checkoutServiceFeeJod !== undefined) {
        if (body.checkoutServiceFeeJod === null || body.checkoutServiceFeeJod === '') {
          delete stores[idx].checkoutServiceFeeJod;
        } else {
          const v = Number(body.checkoutServiceFeeJod);
          stores[idx].checkoutServiceFeeJod = Number.isFinite(v) && v >= 0 ? v : 0;
        }
      }
      if (body.checkoutDeliveryFeeJod !== undefined) {
        if (body.checkoutDeliveryFeeJod === null || body.checkoutDeliveryFeeJod === '') {
          delete stores[idx].checkoutDeliveryFeeJod;
        } else {
          const v = Number(body.checkoutDeliveryFeeJod);
          stores[idx].checkoutDeliveryFeeJod = Number.isFinite(v) && v >= 0 ? v : 0;
        }
      }
      if (body.checkoutDeliveryOverCartThresholdJod !== undefined) {
        if (body.checkoutDeliveryOverCartThresholdJod === null || body.checkoutDeliveryOverCartThresholdJod === '') {
          delete stores[idx].checkoutDeliveryOverCartThresholdJod;
        } else {
          const v = Number(body.checkoutDeliveryOverCartThresholdJod);
          stores[idx].checkoutDeliveryOverCartThresholdJod = Number.isFinite(v) && v >= 0 ? v : 0;
        }
      }
      if (body.checkoutDeliveryFeeAboveJod !== undefined) {
        if (body.checkoutDeliveryFeeAboveJod === null || body.checkoutDeliveryFeeAboveJod === '') {
          delete stores[idx].checkoutDeliveryFeeAboveJod;
        } else {
          const v = Number(body.checkoutDeliveryFeeAboveJod);
          stores[idx].checkoutDeliveryFeeAboveJod = Number.isFinite(v) && v >= 0 ? v : 0;
        }
      }
    }
    if (body.paymentMethods !== undefined) {
      if (body.paymentMethods === null) {
        delete stores[idx].paymentMethods;
      } else if (typeof body.paymentMethods === 'object') {
        const merged = mergeStorePaymentMethodsPatch(stores[idx], body.paymentMethods);
        const v = validatePaymentMethodsEnabled(merged);
        if (!v.ok) {
          return res.status(400).json({ success: false, message: v.message });
        }
        stores[idx].paymentMethods = merged;
      }
    }
    const skipAllowed = new Set();
    if (body.openingHours !== undefined) {
      const n = normalizeOpeningHoursFromBody(body.openingHours, stores[idx]);
      stores[idx].openingHours = n.openingHours;
      stores[idx].closingTime = n.closingTime;
      skipAllowed.add('openingHours');
      skipAllowed.add('closingTime');
    } else if (body.closingTime !== undefined) {
      const ct = body.closingTime;
      const oh =
        stores[idx].openingHours && typeof stores[idx].openingHours === 'object'
          ? { ...stores[idx].openingHours }
          : { open: '09:00' };
      if (ct === null || ct === '' || (typeof ct === 'string' && !ct.trim())) {
        stores[idx].closingTime = null;
        delete oh.close;
        stores[idx].openingHours = oh;
      } else {
        const c = parseFlexibleTimeTo24h(String(ct).trim(), null);
        const closeVal = c || String(ct).trim();
        stores[idx].closingTime = closeVal;
        oh.close = closeVal;
        stores[idx].openingHours = oh;
      }
      skipAllowed.add('closingTime');
    }
    for (const key of allowed) {
      if (skipAllowed.has(key)) continue;
      if (body[key] !== undefined) stores[idx][key] = body[key];
    }
    try {
      saveStores(stores);
    } catch (e) {
      console.error('Failed to save store update:', e);
      return res.status(500).json({ success: false, message: 'Failed to save store changes' });
    }
    const patched = enrichStoreOpeningHours({ ...stores[idx] });
    patched.fcmToken = getStoreFcmToken(db, stores[idx].id) ?? null;
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'store',
      resourceId: String(stores[idx].id),
      storeScopeId: String(stores[idx].id),
      summary: `Updated store ${patched.nameEn || patched.name || req.params.id}`,
      details: { keys: Object.keys(body || {}) },
    });
    return res.status(200).json({
      success: true,
      data: { store: patched },
    });
  });

  /** Bulk set displayOrder for stores (Admin / SuperAdmin). Body: { order: [{ id, displayOrder }] } */
  app.post('/api/admin/stores/reorder', auth, requireAdminOrSuper, (req, res) => {
    try {
      const items = req.body?.order;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Provide { order: [{ id, displayOrder }] }' });
      }
      const stores = loadStores();
      let changed = 0;
      for (const item of items) {
        const idx = stores.findIndex((s) => String(s.id) === String(item.id));
        if (idx === -1) continue;
        const val = item.displayOrder === null || item.displayOrder === '' ? undefined : Number(item.displayOrder);
        stores[idx].displayOrder = val;
        changed++;
      }
      saveStores(stores);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'store',
        resourceId: 'bulk',
        storeScopeId: null,
        summary: `Reordered ${changed} store(s) display order`,
      });
      return res.status(200).json({ success: true, data: { changed } });
    } catch (e) {
      console.error('Stores reorder error:', e);
      return res.status(500).json({ success: false, message: 'Failed to reorder stores' });
    }
  });

  /** Apply checkout delivery/service fee flags to many stores (Admin / SuperAdmin). */
  app.post('/api/admin/stores/bulk-checkout-policy', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const stores = loadStores();
    const targetIds =
      body.applyToAll === true
        ? stores.map((s) => String(s.id))
        : Array.isArray(body.storeIds)
          ? body.storeIds.map((x) => String(x).trim()).filter(Boolean)
          : [];
    if (targetIds.length === 0) {
      return res.status(400).json({ success: false, message: 'applyToAll: true or non-empty storeIds[] is required' });
    }
    const resetAll = body.resetCheckoutFeeOverrides === true;
    const hasAny =
      resetAll ||
      body.checkoutDeliveryFeeZero !== undefined ||
      body.checkoutServiceFeeDisabled !== undefined ||
      body.checkoutServiceFeeJod !== undefined ||
      body.checkoutDeliveryFeeJod !== undefined ||
      body.checkoutDeliveryOverCartThresholdJod !== undefined ||
      body.checkoutDeliveryFeeAboveJod !== undefined;
    if (!hasAny) {
      return res.status(400).json({
        success: false,
        message:
          'No policy fields (resetCheckoutFeeOverrides or checkoutDeliveryFeeZero, checkoutDeliveryFeeJod, checkoutServiceFeeDisabled, checkoutServiceFeeJod, checkoutDeliveryOverCartThresholdJod, checkoutDeliveryFeeAboveJod)',
      });
    }
    let updatedCount = 0;
    for (const sid of targetIds) {
      const idx = stores.findIndex((s) => String(s.id) === String(sid));
      if (idx === -1) continue;
      if (resetAll) {
        stores[idx].checkoutDeliveryFeeZero = false;
        stores[idx].checkoutServiceFeeDisabled = false;
        delete stores[idx].checkoutServiceFeeJod;
        delete stores[idx].checkoutDeliveryFeeJod;
        delete stores[idx].checkoutDeliveryOverCartThresholdJod;
        delete stores[idx].checkoutDeliveryFeeAboveJod;
      } else {
        if (body.checkoutDeliveryFeeZero !== undefined) {
          stores[idx].checkoutDeliveryFeeZero = coercePatchBoolean(body.checkoutDeliveryFeeZero);
        }
        if (body.checkoutServiceFeeDisabled !== undefined) {
          stores[idx].checkoutServiceFeeDisabled = coercePatchBoolean(body.checkoutServiceFeeDisabled);
        }
        if (body.checkoutServiceFeeJod !== undefined) {
          if (body.checkoutServiceFeeJod === null || body.checkoutServiceFeeJod === '') {
            delete stores[idx].checkoutServiceFeeJod;
          } else {
            const v = Number(body.checkoutServiceFeeJod);
            stores[idx].checkoutServiceFeeJod = Number.isFinite(v) && v >= 0 ? v : 0;
          }
        }
        if (body.checkoutDeliveryFeeJod !== undefined) {
          if (body.checkoutDeliveryFeeJod === null || body.checkoutDeliveryFeeJod === '') {
            delete stores[idx].checkoutDeliveryFeeJod;
          } else {
            const v = Number(body.checkoutDeliveryFeeJod);
            stores[idx].checkoutDeliveryFeeJod = Number.isFinite(v) && v >= 0 ? v : 0;
          }
        }
        if (body.checkoutDeliveryOverCartThresholdJod !== undefined) {
          if (body.checkoutDeliveryOverCartThresholdJod === null || body.checkoutDeliveryOverCartThresholdJod === '') {
            delete stores[idx].checkoutDeliveryOverCartThresholdJod;
          } else {
            const v = Number(body.checkoutDeliveryOverCartThresholdJod);
            stores[idx].checkoutDeliveryOverCartThresholdJod = Number.isFinite(v) && v >= 0 ? v : 0;
          }
        }
        if (body.checkoutDeliveryFeeAboveJod !== undefined) {
          if (body.checkoutDeliveryFeeAboveJod === null || body.checkoutDeliveryFeeAboveJod === '') {
            delete stores[idx].checkoutDeliveryFeeAboveJod;
          } else {
            const v = Number(body.checkoutDeliveryFeeAboveJod);
            stores[idx].checkoutDeliveryFeeAboveJod = Number.isFinite(v) && v >= 0 ? v : 0;
          }
        }
      }
      updatedCount += 1;
    }
    try {
      saveStores(stores);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: 'Failed to save stores' });
    }
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'store',
      resourceId: 'bulk-checkout-policy',
      storeScopeId: null,
      summary: `Bulk checkout policy for ${updatedCount} store(s)`,
    });
    return res.status(200).json({ success: true, data: { updatedCount } });
  });

  // Clone store: SuperAdmin/Admin can clone any store; Store Admin can clone only their store
  app.post('/api/admin/stores/:id/clone', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const sourceId = req.params.id;
    const body = req.body || {};
    const stores = loadStores();
    const sourceStore = stores.find((s) => String(s.id) === String(sourceId));
    if (!sourceStore) return res.status(404).json({ success: false, message: 'Store not found' });

    const ids = stores.map((s) => parseInt(String(s.id), 10)).filter((n) => !isNaN(n));
    const nextId = ids.length ? String(Math.max(...ids) + 1) : '1';

    const newStore = {
      id: nextId,
      name: sourceStore.name ?? '',
      nameAr: sourceStore.nameAr ?? sourceStore.name ?? '',
      nameEn: sourceStore.nameEn ?? sourceStore.name ?? '',
      cover: sourceStore.cover ?? '',
      logo: sourceStore.logo ?? '',
      rate: sourceStore.rate ?? 4,
      numberOfReviews: 0,
      isFavorite: false,
      deliveryTime: sourceStore.deliveryTime ?? '30-45 min',
      deliveryFee: sourceStore.deliveryFee ?? 0,
      minimumOrder: sourceStore.minimumOrder ?? 0,
      isOpen: sourceStore.isOpen !== false,
      openingHours: sourceStore.openingHours
        ? { ...sourceStore.openingHours }
        : { open: '09:00' },
      address: body.address ?? body.addressEn ?? sourceStore.address ?? '',
      addressAr: body.addressAr ?? body.address ?? sourceStore.addressAr ?? '',
      addressEn: body.addressEn ?? body.address ?? sourceStore.addressEn ?? '',
      phone: sourceStore.phone ?? '',
      category: sourceStore.category ?? 'restaurants',
      categoryAr: sourceStore.categoryAr ?? sourceStore.category ?? '',
      categoryEn: sourceStore.categoryEn ?? sourceStore.category ?? '',
      subCategories: Array.isArray(sourceStore.subCategories) ? [...sourceStore.subCategories] : [],
      isPremium: sourceStore.isPremium === true,
      mapsUrl: body.mapsUrl ?? sourceStore.mapsUrl ?? '',
      closingTime: body.closingTime ?? sourceStore.closingTime ?? null,
      arhebFee: sourceStore.arhebFee != null ? sourceStore.arhebFee : null,
      storeCategories: Array.isArray(sourceStore.storeCategories) ? [...sourceStore.storeCategories] : [],
      paused: false,
      blocked: false,
    };
    stores.push(newStore);
    saveStores(stores);

    try {
      const insertStoreListing = db.prepare(`
        INSERT INTO store_listings (id, name, nameAr, nameEn, cover, logo, rate, numberOfReviews, isFavorite, deliveryTime, deliveryFee, minimumOrder, isOpen, openingHoursOpen, openingHoursClose, address, addressAr, addressEn, phone, category, categoryAr, categoryEn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStoreListing.run(
        newStore.id,
        newStore.name ?? null,
        newStore.nameAr ?? null,
        newStore.nameEn ?? null,
        newStore.cover ?? null,
        newStore.logo ?? null,
        newStore.rate ?? null,
        0,
        0,
        newStore.deliveryTime ?? null,
        newStore.deliveryFee ?? null,
        newStore.minimumOrder ?? null,
        newStore.isOpen ? 1 : 0,
        newStore.openingHours?.open ?? null,
        newStore.openingHours?.close ?? null,
        newStore.address ?? null,
        newStore.addressAr ?? null,
        newStore.addressEn ?? null,
        newStore.phone ?? null,
        newStore.category ?? null,
        newStore.categoryAr ?? null,
        newStore.categoryEn ?? null
      );
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }

    const products = loadProducts();
    const sourceProducts = products.filter((p) => String(p.store?.id) === String(sourceId));
    const maxProductId = products.length ? Math.max(...products.map((p) => parseInt(p.id, 10) || 0)) : 0;
    let nextProductId = maxProductId + 1;
    const newProducts = sourceProducts.map((p) => {
      const cloned = JSON.parse(JSON.stringify(p));
      cloned.id = String(nextProductId++);
      cloned.store = {
        id: newStore.id,
        name: newStore.name,
        nameAr: newStore.nameAr,
        nameEn: newStore.nameEn,
        cover: newStore.cover,
        logo: newStore.logo,
        rate: newStore.rate,
        numberOfReviews: newStore.numberOfReviews,
        isFavorite: newStore.isFavorite,
      };
      return cloned;
    });
    products.push(...newProducts);
    saveProducts(products);

    logActivity(db, req, {
      action: 'add',
      resourceType: 'store_clone',
      resourceId: String(newStore.id),
      storeScopeId: String(newStore.id),
      summary: `Cloned store from ${sourceId} → ${newStore.id} (${newProducts.length} products)`,
    });
    return res.status(201).json({
      success: true,
      message: 'Store cloned successfully',
      data: { store: newStore, productsCloned: newProducts.length },
    });
  });

  app.delete('/api/admin/stores/:id', auth, requireAdminOrSuper, (req, res) => {
    const storeId = req.params.id;
    const stores = loadStores();
    const idx = stores.findIndex((s) => String(s.id) === String(storeId));
    if (idx === -1) return res.status(404).json({ success: false, message: 'Store not found' });
    stores.splice(idx, 1);
    saveStores(stores);
    const products = loadProducts();
    const remaining = products.filter((p) => String(p.store?.id) !== String(storeId));
    if (remaining.length !== products.length) {
      saveProducts(remaining);
    }
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'store',
      resourceId: String(storeId),
      storeScopeId: String(storeId),
      summary: `Deleted store ${storeId}`,
    });
    return res.status(200).json({ success: true, message: 'Store deleted' });
  });

  // ——— Pending products (approval queue) ———
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storeId TEXT NOT NULL,
      submittedBy INTEGER NOT NULL,
      productData TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewedBy INTEGER,
      reviewNote TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewedAt TEXT
    )
  `);

  function buildProductObject(body, store) {
    const products = loadProducts();
    const id = String(products.length ? Math.max(...products.map((p) => parseInt(p.id, 10) || 0)) + 1 : 1);
    return {
      id,
      name: body.name ?? '',
      nameAr: body.nameAr ?? body.name ?? '',
      nameEn: body.nameEn ?? body.name ?? '',
      image: body.image ?? '',
      images: Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []),
      price: typeof body.price === 'number' ? body.price : parseFloat(body.price) || 0,
      originalPrice: typeof body.originalPrice === 'number' ? body.originalPrice : (parseFloat(body.originalPrice) || (body.price != null ? body.price : 0)),
      discount: body.discount ?? null,
      unit: body.unit ?? 'piece',
      unitAr: body.unitAr ?? body.unit ?? 'piece',
      unitEn: body.unitEn ?? body.unit ?? 'piece',
      category: body.category ?? '',
      categoryAr: body.categoryAr ?? body.category ?? '',
      categoryEn: body.categoryEn ?? body.category ?? '',
      subCategory: body.subCategory ?? '',
      subCategoryAr: body.subCategoryAr ?? body.subCategory ?? '',
      subCategoryEn: body.subCategoryEn ?? body.subCategory ?? '',
      description: body.description ?? '',
      descriptionAr: body.descriptionAr ?? body.description ?? '',
      descriptionEn: body.descriptionEn ?? body.description ?? '',
      stock: typeof body.stock === 'number' ? body.stock : parseInt(body.stock, 10) || 0,
      isAvailable: body.isAvailable !== false,
      store: {
        id: store.id,
        name: store.name,
        nameAr: store.nameAr,
        nameEn: store.nameEn,
        cover: store.cover,
        logo: store.logo,
        rate: store.rate,
        numberOfReviews: store.numberOfReviews,
        isFavorite: store.isFavorite,
      },
      addOnGroups: sanitizeAddOnGroups(body.addOnGroups),
    };
  }

  // ——— Products (per store) ———
  app.get('/api/admin/stores/:storeId/products', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const products = loadProducts();
    let storeProducts = products.filter((p) => String(p.store?.id) === String(req.params.storeId));

    const nameQuery = (req.query.name || '').trim().toLowerCase();
    if (nameQuery) {
      storeProducts = storeProducts.filter((p) => {
        const n = String(p.name || '').toLowerCase();
        const nAr = String(p.nameAr || '').toLowerCase();
        const nEn = String(p.nameEn || '').toLowerCase();
        return n.includes(nameQuery) || nAr.includes(nameQuery) || nEn.includes(nameQuery);
      });
    }

    return res.status(200).json({ success: true, data: { products: storeProducts } });
  });

  app.post('/api/admin/stores/:storeId/products', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const storeId = req.params.storeId;
    const stores = loadStores();
    const store = stores.find((s) => String(s.id) === String(storeId));
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can add products.' });
    }
    const body = req.body || {};

    if (req.admin.role === ROLES.STORE_ADMIN) {
      const productData = buildProductObject(body, store);
      db.prepare(
        'INSERT INTO pending_products (storeId, submittedBy, productData, status) VALUES (?, ?, ?, ?)'
      ).run(storeId, req.admin.adminId, JSON.stringify(productData), 'pending');
      const pending = db.prepare('SELECT * FROM pending_products WHERE id = last_insert_rowid()').get();
      logActivity(db, req, {
        action: 'add',
        resourceType: 'pending_product',
        resourceId: String(pending.id),
        storeScopeId: String(storeId),
        summary: `Submitted product for approval (pending #${pending.id})`,
      });
      return res.status(201).json({
        success: true,
        message: 'Product submitted for approval. An admin will review it.',
        data: {
          pendingId: pending.id,
          status: 'pending',
          product: productData,
        },
      });
    }

    const products = loadProducts();
    const newProduct = buildProductObject(body, store);
    products.push(newProduct);
    saveProducts(products);
    logActivity(db, req, {
      action: 'add',
      resourceType: 'product',
      resourceId: String(newProduct.id),
      storeScopeId: String(storeId),
      summary: `Added product ${newProduct.nameEn || newProduct.name || newProduct.id} to store ${storeId}`,
    });
    return res.status(201).json({ success: true, data: { product: newProduct } });
  });

  const EXCEL_HEADERS = ['id', 'nameEn', 'nameAr', 'name', 'price', 'originalPrice', 'discount', 'unit', 'category', 'categoryAr', 'categoryEn', 'description', 'stock', 'isAvailable'];

  app.post('/api/admin/stores/:storeId/products/import', auth, requireStoreAccess((req) => req.params.storeId), upload.single('file'), (req, res) => {
    const storeId = req.params.storeId;
    const stores = loadStores();
    const store = stores.find((s) => String(s.id) === String(storeId));
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can import products.' });
    }
    if (!req.file || !req.file.buffer) return res.status(400).json({ success: false, message: 'No file uploaded. Use field name "file".' });
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid Excel file' });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return res.status(400).json({ success: false, message: 'Empty workbook' });
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) return res.status(400).json({ success: false, message: 'Excel must have header row and at least one data row' });
    const headerRow = rows[0].map((h) => (h != null ? String(h).trim() : ''));
    const colIndex = (key) => headerRow.findIndex((h) => h.toLowerCase() === key.toLowerCase() || h === key);
    const products = loadProducts();
    const storeProductIds = new Set(
      products.filter((p) => String(p.store?.id) === String(storeId)).map((p) => String(p.id))
    );
    const isStoreAdmin = req.admin.role === ROLES.STORE_ADMIN;
    let created = 0;
    let skipped = 0;
    let errors = [];
    const seenIdInFile = new Set();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const get = (key) => {
        const idx = colIndex(key);
        if (idx < 0) return '';
        const v = row[idx];
        return v != null ? String(v).trim() : '';
      };
      const rowId = get('id');
      if (rowId) {
        if (storeProductIds.has(rowId)) {
          skipped++;
          continue;
        }
        if (seenIdInFile.has(rowId)) {
          skipped++;
          continue;
        }
      }
      const nameEn = get('nameEn') || get('name');
      if (!nameEn) continue;
      const body = {
        nameEn,
        nameAr: get('nameAr') || nameEn,
        name: get('name') || nameEn,
        price: parseFloat(get('price')) || 0,
        originalPrice: get('originalPrice') ? parseFloat(get('originalPrice')) : undefined,
        discount: get('discount') || null,
        unit: get('unit') || 'piece',
        category: get('category'),
        categoryAr: get('categoryAr') || get('category'),
        categoryEn: get('categoryEn') || get('category'),
        description: get('description'),
        stock: parseInt(get('stock'), 10) || 0,
        isAvailable: (get('isAvailable') || 'Y').toUpperCase() !== 'N',
      };
      try {
        const newProduct = buildProductObject(body, store);
        if (isStoreAdmin) {
          db.prepare('INSERT INTO pending_products (storeId, submittedBy, productData, status) VALUES (?, ?, ?, ?)').run(storeId, req.admin.adminId, JSON.stringify(newProduct), 'pending');
        } else {
          products.push(newProduct);
          saveProducts(products);
        }
        created++;
        if (rowId) seenIdInFile.add(rowId);
      } catch (e) {
        errors.push(`Row ${i + 1}: ${e.message || 'Failed'}`);
      }
    }
    logActivity(db, req, {
      action: 'add',
      resourceType: isStoreAdmin ? 'pending_product' : 'product',
      resourceId: 'import',
      storeScopeId: String(storeId),
      summary: isStoreAdmin
        ? `Excel import: ${created} pending product(s) submitted`
        : `Excel import: ${created} product(s) created`,
      details: { created, skipped, errorCount: errors.length },
    });
    return res.status(200).json({
      success: true,
      message: isStoreAdmin ? `${created} product(s) submitted for approval` : `${created} product(s) imported`,
      data: { created, skipped, errors: errors.length ? errors : undefined },
    });
  });

  app.get('/api/admin/stores/:storeId/products/export', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const storeId = req.params.storeId;
    const categoryFilterRaw = req.query.categoryFilter;
    const categoryFilter =
      categoryFilterRaw != null && String(categoryFilterRaw).trim() !== '' && String(categoryFilterRaw).trim().toLowerCase() !== 'all'
        ? String(categoryFilterRaw).trim().toLowerCase()
        : '';
    const products = loadProducts();
    let storeProducts = products.filter((p) => p.store?.id === storeId);
    if (categoryFilter) {
      storeProducts = storeProducts.filter((p) => {
        const vals = [p.category, p.categoryEn, p.categoryAr].map((x) => String(x ?? '').trim().toLowerCase());
        return vals.some((v) => v === categoryFilter);
      });
    }
    const rows = [EXCEL_HEADERS];
    storeProducts.forEach((p) => {
      rows.push([
        p.id ?? '',
        p.nameEn ?? '',
        p.nameAr ?? '',
        p.name ?? '',
        p.price ?? 0,
        p.originalPrice ?? '',
        p.discount ?? '',
        p.unit ?? 'piece',
        p.category ?? '',
        p.categoryAr ?? '',
        p.categoryEn ?? '',
        p.description ?? '',
        p.stock ?? 0,
        p.isAvailable !== false ? 'Y' : 'N',
      ]);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const catSlug = categoryFilter ? `-cat-${categoryFilter.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40)}` : '';
    res.setHeader('Content-Disposition', `attachment; filename="store-${storeId}-products${catSlug}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  });

  // List pending products
  app.get('/api/admin/pending-products', auth, (req, res) => {
    let rows;
    if (req.admin.role === ROLES.STORE_ADMIN) {
      rows = db.prepare('SELECT * FROM pending_products WHERE storeId = ? ORDER BY id DESC').all(req.admin.storeId);
    } else {
      rows = db.prepare('SELECT * FROM pending_products ORDER BY id DESC').all();
    }
    const list = rows.map((r) => {
      let product = {};
      try { product = JSON.parse(r.productData); } catch (_) {}
      return {
        id: r.id,
        storeId: r.storeId,
        submittedBy: r.submittedBy,
        status: r.status,
        reviewedBy: r.reviewedBy,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        product,
      };
    });
    return res.status(200).json({ success: true, data: { pendingProducts: list } });
  });

  // View pending product detail
  app.get('/api/admin/pending-products/:id', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const row = db.prepare('SELECT * FROM pending_products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Pending product not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && !sameStoreId(row.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    let product = {};
    try { product = JSON.parse(row.productData); } catch (_) {}
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        storeId: row.storeId,
        submittedBy: row.submittedBy,
        status: row.status,
        reviewedBy: row.reviewedBy,
        reviewNote: row.reviewNote,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        product,
      },
    });
  });

  // Approve pending product (SuperAdmin / Admin only)
  app.post('/api/admin/pending-products/:id/approve', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const row = db.prepare('SELECT * FROM pending_products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Pending product not found' });
    if (row.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Product already ${row.status}` });
    }
    let productData = {};
    try { productData = JSON.parse(row.productData); } catch (_) {}

    const products = loadProducts();
    const newId = String(products.length ? Math.max(...products.map((p) => parseInt(p.id, 10) || 0)) + 1 : 1);
    productData.id = newId;
    products.push(productData);
    saveProducts(products);

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE pending_products SET status = ?, reviewedBy = ?, reviewedAt = ?, productData = ? WHERE id = ?'
    ).run('approved', req.admin.adminId, now, JSON.stringify(productData), id);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'pending_product',
      resourceId: String(id),
      storeScopeId: String(row.storeId),
      summary: `Approved pending product #${id} → product ${productData.id}`,
    });
    return res.status(200).json({
      success: true,
      message: 'Product approved and added to store',
      data: { product: productData },
    });
  });

  // Reject pending product (SuperAdmin / Admin only)
  app.post('/api/admin/pending-products/:id/reject', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const row = db.prepare('SELECT * FROM pending_products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Pending product not found' });
    if (row.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Product already ${row.status}` });
    }
    const { note } = req.body || {};
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE pending_products SET status = ?, reviewedBy = ?, reviewNote = ?, reviewedAt = ? WHERE id = ?'
    ).run('rejected', req.admin.adminId, note || null, now, id);
    let product = {};
    try { product = JSON.parse(row.productData); } catch (_) {}
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'pending_product',
      resourceId: String(id),
      storeScopeId: String(row.storeId),
      summary: `Rejected pending product #${id}`,
      details: { note: note || null },
    });
    return res.status(200).json({
      success: true,
      message: 'Product rejected',
      data: { id: row.id, status: 'rejected', note: note || null, product },
    });
  });

  app.patch('/api/admin/stores/:storeId/products/:productId', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId, productId } = req.params;
    const stores = loadStores();
    const store = stores.find((s) => String(s.id) === String(storeId));
    if (store && store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can edit products.' });
    }
    const products = loadProducts();
    const idx = products.findIndex((p) => String(p.id) === String(productId) && String(p.store?.id) === String(storeId));
    if (idx === -1) return res.status(404).json({ success: false, message: 'Product not found' });
    const allowed = [
      'name', 'nameAr', 'nameEn', 'image', 'images', 'price', 'originalPrice', 'discount',
      'unit', 'unitAr', 'unitEn', 'category', 'categoryAr', 'categoryEn',
      'subCategory', 'subCategoryAr', 'subCategoryEn',
      'description', 'descriptionAr', 'descriptionEn', 'stock', 'isAvailable',
      'ingredients', 'ingredientsAr', 'ingredientsEn', 'allergens', 'allergensAr', 'allergensEn',
      'nutritionalInfo', 'preparationTime', 'addOnGroups',
    ];
    const body = req.body || {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (key === 'addOnGroups') {
          products[idx][key] = sanitizeAddOnGroups(body[key]);
        } else {
          products[idx][key] = body[key];
        }
      }
    }
    saveProducts(products);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'product',
      resourceId: String(productId),
      storeScopeId: String(storeId),
      summary: `Updated product ${productId} in store ${storeId}`,
      details: { keys: Object.keys(req.body || {}) },
    });
    return res.status(200).json({ success: true, data: { product: products[idx] } });
  });

  // Bulk apply same discount (%) to multiple products — same field as single-product discount
  app.post('/api/admin/stores/:storeId/products/bulk-discount', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId } = req.params;
    const stores = loadStores();
    const store = stores.find((s) => String(s.id) === String(storeId));
    if (store && store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can edit products.' });
    }
    const { productIds, discount } = req.body || {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, message: 'productIds array is required' });
    }
    let disc = discount;
    if (disc === undefined || disc === null || disc === '') {
      return res.status(400).json({ success: false, message: 'discount is required (number or string e.g. 10 or 10%)' });
    }
    if (typeof disc === 'number' && (isNaN(disc) || disc < 0 || disc > 100)) {
      return res.status(400).json({ success: false, message: 'discount must be between 0 and 100' });
    }
    if (typeof disc === 'string') {
      const n = parseFloat(String(disc).replace('%', '').trim());
      if (isNaN(n) || n < 0 || n > 100) {
        return res.status(400).json({ success: false, message: 'Invalid discount value' });
      }
      disc = n;
    }
    const products = loadProducts();
    const idSet = new Set(productIds.map((id) => String(id)));
    let updated = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (String(p.store?.id) !== String(storeId)) continue;
      if (!idSet.has(String(p.id))) continue;
      products[i] = { ...p, discount: disc };
      updated += 1;
    }
    if (updated === 0) {
      return res.status(404).json({ success: false, message: 'No matching products in this store' });
    }
    saveProducts(products);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'product',
      resourceId: 'bulk',
      storeScopeId: String(storeId),
      summary: `Bulk discount ${disc}% on ${updated} products`,
    });
    return res.status(200).json({ success: true, data: { updated, discount: disc } });
  });

  app.post('/api/admin/stores/:storeId/products/bulk-remove-discount', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId } = req.params;
    const stores = loadStores();
    const store = stores.find((s) => String(s.id) === String(storeId));
    if (store && store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can edit products.' });
    }
    const { productIds } = req.body || {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, message: 'productIds array is required' });
    }
    const products = loadProducts();
    const idSet = new Set(productIds.map((id) => String(id)));
    let updated = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (String(p.store?.id) !== String(storeId)) continue;
      if (!idSet.has(String(p.id))) continue;
      products[i] = { ...p, discount: null };
      updated += 1;
    }
    if (updated === 0) {
      return res.status(404).json({ success: false, message: 'No matching products in this store' });
    }
    saveProducts(products);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'product',
      resourceId: 'bulk',
      storeScopeId: String(storeId),
      summary: `Bulk remove discount on ${updated} products`,
    });
    return res.status(200).json({ success: true, data: { updated } });
  });

  app.delete('/api/admin/stores/:storeId/products/:productId', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId, productId } = req.params;
    const stores = loadStores();
    const store = stores.find((s) => String(s.id) === String(storeId));
    if (store && store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can delete products.' });
    }
    const products = loadProducts();
    const idx = products.findIndex((p) => String(p.id) === String(productId) && String(p.store?.id) === String(storeId));
    if (idx === -1) return res.status(404).json({ success: false, message: 'Product not found' });
    products.splice(idx, 1);
    saveProducts(products);
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'product',
      resourceId: String(productId),
      storeScopeId: String(storeId),
      summary: `Deleted product ${productId} from store ${storeId}`,
    });
    return res.status(200).json({ success: true, message: 'Product deleted' });
  });

  // ——— Driver requests (orderId, driverId, status: pending|accepted|rejected) ———
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS driver_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId INTEGER NOT NULL,
        driverId INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(orderId, driverId)
      )
    `);
  } catch (e) {
    // table exists
  }

  // ——— Orders: same DB/table as checkout and order tracking; Store Admin sees their store or unassigned (null storeId) ———
  app.get('/api/admin/orders/counts', auth, (req, res) => {
    const range = resolveOrdersListDateRange(req.query || {});
    const conditions = [];
    const params = [];
    if (req.admin.role === ROLES.STORE_ADMIN) {
      conditions.push('(CAST(storeId AS TEXT) = ? OR storeId IS NULL)');
      params.push(String(req.admin.storeId));
    } else if (req.admin.role === ROLES.ADMIN || req.admin.role === ROLES.SUPERADMIN) {
      const storeIdsRaw = req.query.storeIds || req.query.storeId;
      if (storeIdsRaw) {
        const ids = (Array.isArray(storeIdsRaw) ? storeIdsRaw : String(storeIdsRaw).split(',')).map((s) => String(s).trim()).filter(Boolean);
        if (ids.length > 0) {
          conditions.push('(CAST(storeId AS TEXT) IN (' + ids.map(() => '?').join(',') + '))');
          params.push(...ids);
        }
      }
    }
    if (!range.allDates && range.dateFrom) {
      conditions.push('date(createdAt) >= date(?)');
      params.push(range.dateFrom);
    }
    if (!range.allDates && range.dateTo) {
      conditions.push('date(createdAt) <= date(?)');
      params.push(range.dateTo);
    }
    const wherePrefix = conditions.length ? ' WHERE ' + conditions.join(' AND ') + ' AND ' : ' WHERE ';
    const activeSql = 'SELECT COUNT(*) AS n FROM orders' + wherePrefix + "(status IS NULL OR status NOT IN ('Delivered', 'Cancelled'))";
    const deliveredSql = "SELECT COUNT(*) AS n FROM orders" + wherePrefix + "status = 'Delivered'";
    const cancelledSql = "SELECT COUNT(*) AS n FROM orders" + wherePrefix + "status = 'Cancelled'";
    let active = db.prepare(activeSql).get(...params)?.n ?? 0;
    let delivered = db.prepare(deliveredSql).get(...params)?.n ?? 0;
    let cancelled = db.prepare(cancelledSql).get(...params)?.n ?? 0;

    if (req.admin.role !== ROLES.STORE_ADMIN) {
      try {
        const boxConds = [];
        const boxParams = [];
        if (!range.allDates && range.dateFrom) {
          boxConds.push('date(createdAt) >= date(?)');
          boxParams.push(range.dateFrom);
        }
        if (!range.allDates && range.dateTo) {
          boxConds.push('date(createdAt) <= date(?)');
          boxParams.push(range.dateTo);
        }
        const boxPrefix = boxConds.length ? boxConds.join(' AND ') + ' AND ' : '';
        const boxActive = db
          .prepare('SELECT COUNT(*) AS n FROM arheb_box_requests WHERE ' + boxPrefix + "status NOT IN ('delivered', 'cancelled')")
          .get(...boxParams)?.n ?? 0;
        const boxDelivered = db
          .prepare('SELECT COUNT(*) AS n FROM arheb_box_requests WHERE ' + boxPrefix + "status = 'delivered'")
          .get(...boxParams)?.n ?? 0;
        const boxCancelled = db
          .prepare('SELECT COUNT(*) AS n FROM arheb_box_requests WHERE ' + boxPrefix + "status = 'cancelled'")
          .get(...boxParams)?.n ?? 0;
        active += boxActive;
        delivered += boxDelivered;
        cancelled += boxCancelled;
      } catch (e) { /* table may not exist */ }
    }

    return res.status(200).json({
      success: true,
      data: { active, delivered, cancelled, complete: delivered + cancelled, dateRange: range },
    });
  });

  /** Only SuperAdmin may move an order to an earlier step in the main flow (or reopen Delivered/Cancelled). */
  function isBackwardOrderStatusTransition(currentStatus, nextStatus) {
    const cur = String(currentStatus || '').trim().toLowerCase();
    const next = String(nextStatus || '').trim().toLowerCase();
    if (next === 'cancelled') return false;
    if (cur === 'cancelled' && next !== 'cancelled') return true;
    if (cur === 'delivered' && next !== 'delivered') return true;
    const rank = {
      'waiting confirmation': 0,
      'waiting cliq confirmation': 1,
      'payment rejected': 2,
      preparing: 3,
      'driver to pick': 3.5,
      'in progress': 3.5,
      'on the way': 4,
      delivered: 5,
    };
    const cr = rank[cur];
    const nr = rank[next];
    if (cr === undefined || nr === undefined) return false;
    return nr < cr;
  }

  function normalizeOrderStatusKey(status) {
    return String(status || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /** Store Admin may cancel (reject / PATCH → Cancelled) only before the order is confirmed for preparation. */
  function storeAdminMayCancelOrder(status) {
    return ['pending payment', 'waiting cliq confirmation', 'waiting confirmation'].includes(normalizeOrderStatusKey(status));
  }

  /**
   * Exact next status(es) Store Admin may set via PATCH (one step forward; no skipping).
   * SuperAdmin/Admin are not limited by this list.
   */
  function storeAdminAllowedNextStatuses(currentStatus) {
    const cur = normalizeOrderStatusKey(currentStatus);
    if (cur === 'being prepared') return ['On the way'];
    const nextBy = {
      'pending payment': ['Waiting cliq confirmation', 'Waiting confirmation'],
      'waiting cliq confirmation': ['Waiting confirmation', 'Payment rejected'],
      'waiting confirmation': ['Preparing'],
      'payment rejected': [],
      preparing: ['On the way'],
      'driver to pick': ['On the way'],
      'in progress': ['On the way'],
      'on the way': ['Delivered'],
    };
    return nextBy[cur] || [];
  }

  // ——— Orders (sorted newest first; filter by date range, status, store, name, orderType, paymentType, driver) ———
  function buildAdminOrdersList(req) {
    const range = resolveOrdersListDateRange(req.query || {});
    const { status, storeId, storeIds, storeName, name, orderType, statusFilter, paymentType, driverId, unassigned, orderId } = req.query;
    const paymentTypeTrimmed =
      paymentType && String(paymentType).trim() ? String(paymentType).trim() : '';
    const onlyArhebBox = orderType === 'arheb_box';
    const onlyStore = orderType === 'store';
    const orderIdNum =
      orderId !== undefined && orderId !== null && String(orderId).trim() !== ''
        ? parseInt(String(orderId).trim(), 10)
        : NaN;
    const filterByOrderId = !isNaN(orderIdNum);

    let storeOrders = [];
    if (!onlyArhebBox) {
      const conditions = [];
      const params = [];

      if (req.admin.role === ROLES.STORE_ADMIN) {
        conditions.push('(CAST(storeId AS TEXT) = ? OR storeId IS NULL)');
        params.push(String(req.admin.storeId));
      } else if (req.admin.role === ROLES.ADMIN || req.admin.role === ROLES.SUPERADMIN) {
        const storeIdsRaw = storeIds || storeId;
        if (storeIdsRaw) {
          const ids = (Array.isArray(storeIdsRaw) ? storeIdsRaw : String(storeIdsRaw).split(',')).map((s) => String(s).trim()).filter(Boolean);
          if (ids.length > 0) {
            conditions.push('(CAST(storeId AS TEXT) IN (' + ids.map(() => '?').join(',') + '))');
            params.push(...ids);
          }
        }
      }
      if (filterByOrderId) {
        conditions.push('id = ?');
        params.push(orderIdNum);
      } else {
        if (!range.allDates && range.dateFrom) { conditions.push("date(createdAt) >= date(?)"); params.push(range.dateFrom); }
        if (!range.allDates && range.dateTo) { conditions.push("date(createdAt) <= date(?)"); params.push(range.dateTo); }
      }
      if (statusFilter === 'active') {
        conditions.push("(status IS NULL OR status NOT IN ('Delivered', 'Cancelled'))");
      } else if (statusFilter === 'complete') {
        conditions.push("status IN ('Delivered', 'Cancelled')");
      } else if (statusFilter === 'delivered') {
        conditions.push("status = 'Delivered'");
      } else if (statusFilter === 'cancelled') {
        conditions.push("status = 'Cancelled'");
      }
      if (status && String(status).trim()) { conditions.push('status = ?'); params.push(String(status).trim()); }
      if (paymentTypeTrimmed) {
        conditions.push("LOWER(TRIM(COALESCE(paymentType, ''))) = LOWER(?)");
        params.push(paymentTypeTrimmed);
      }
      if (unassigned === 'true' || unassigned === '1') {
        conditions.push('driverId IS NULL');
      } else if (driverId !== undefined && driverId !== null && String(driverId).trim() !== '') {
        const did = parseInt(String(driverId).trim(), 10);
        if (!isNaN(did)) { conditions.push('driverId = ?'); params.push(did); }
      }
      if (name && String(name).trim()) {
        const term = '%' + String(name).trim() + '%';
        conditions.push('(name LIKE ? OR phoneNumber LIKE ?)');
        params.push(term, term);
      }

      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const sql = 'SELECT * FROM orders' + where + ' ORDER BY createdAt DESC, id DESC';
      let orders = db.prepare(sql).all(...params);

      if (storeName && String(storeName).trim()) {
        const stores = loadStores();
        const storeNameLower = String(storeName).trim().toLowerCase();
        const matchingStoreIds = new Set(
          stores.filter((s) => (s.nameEn || s.name || '').toLowerCase().includes(storeNameLower) || (s.nameAr || '').toLowerCase().includes(storeNameLower)).map((s) => String(s.id))
        );
        orders = orders.filter((o) => o.storeId != null && matchingStoreIds.has(String(o.storeId)));
      }

      const storesList = loadStores();
      const storeById = Object.fromEntries(storesList.map((s) => [String(s.id), s]));

      storeOrders = orders.map((order) => {
        const items = findOrderItems.all(order.id);
        const store = order.storeId != null ? storeById[String(order.storeId)] : null;
        let driverEarningsJod = null;
        let deliveryNetAfterDriverJod = null;
        if (order.driverId != null) {
          const share = resolveOrderDriverShare(db, order);
          driverEarningsJod = share.earningsJod;
          deliveryNetAfterDriverJod = round2Money(
            Math.max(0, Number(order.deliveryFee) || 0) - (share.earningsJod || 0),
          );
        }
        return enrichWithJordanTime(
          {
            ...order,
            orderType: 'store',
            storeName: store ? (store.nameEn || store.name || store.nameAr) : (order.storeId || '-'),
            storeAddress: store ? (store.addressEn || store.address || store.addressAr || null) : null,
            storeMapsUrl: store ? (store.mapsUrl || null) : null,
            storeLatitude: store?.latitude ?? store?.lat ?? null,
            storeLongitude: store?.longitude ?? store?.long ?? null,
            items: mapOrderItemsForAdmin(items),
            driverEarningsJod,
            deliveryNetAfterDriverJod,
          },
          ['createdAt'],
        );
      });
    }

    let boxOrders = [];
    if (!onlyStore && req.admin.role !== ROLES.STORE_ADMIN) {
      try {
        const boxCond = [];
        const boxParams = [];
        if (filterByOrderId) {
          boxCond.push('id = ?');
          boxParams.push(orderIdNum);
        } else {
          if (!range.allDates && range.dateFrom) { boxCond.push("date(createdAt) >= date(?)"); boxParams.push(range.dateFrom); }
          if (!range.allDates && range.dateTo) { boxCond.push("date(createdAt) <= date(?)"); boxParams.push(range.dateTo); }
        }
        if (status && String(status).trim()) { boxCond.push('status = ?'); boxParams.push(String(status).trim()); }
        if (statusFilter === 'active') {
          boxCond.push("status NOT IN ('delivered', 'cancelled')");
        } else if (statusFilter === 'complete') {
          boxCond.push("status IN ('delivered', 'cancelled')");
        } else if (statusFilter === 'delivered') {
          boxCond.push("status = 'delivered'");
        } else if (statusFilter === 'cancelled') {
          boxCond.push("status = 'cancelled'");
        }
        if (paymentTypeTrimmed) {
          boxCond.push("LOWER(TRIM(COALESCE(paymentMethod, ''))) = LOWER(?)");
          boxParams.push(paymentTypeTrimmed);
        }
        if (unassigned === 'true' || unassigned === '1') {
          boxCond.push('driverId IS NULL');
        } else if (driverId !== undefined && driverId !== null && String(driverId).trim() !== '') {
          const did = parseInt(String(driverId).trim(), 10);
          if (!isNaN(did)) { boxCond.push('driverId = ?'); boxParams.push(did); }
        }
        if (name && String(name).trim()) {
          const term = '%' + String(name).trim() + '%';
          boxCond.push('(userName LIKE ? OR phoneNumber LIKE ?)');
          boxParams.push(term, term);
        }
        const boxWhere = boxCond.length ? ' WHERE ' + boxCond.join(' AND ') : '';
        const boxRows = db.prepare('SELECT * FROM arheb_box_requests' + boxWhere + ' ORDER BY createdAt DESC, id DESC').all(...boxParams);
        boxOrders = boxRows.map((r) => {
          const enriched = enrichArhebBoxRow(r, db);
          const parcelAmount = enriched.amount != null ? Number(enriched.amount) : 0;
          let driverEarningsJod = null;
          let deliveryNetAfterDriverJod = null;
          if (r.driverId != null) {
            const share = resolveArhebBoxDriverShare(db, enriched);
            driverEarningsJod = share.earningsJod;
            deliveryNetAfterDriverJod = round2Money(
              Math.max(0, Number(enriched.deliveryFee) || 0) - (share.earningsJod || 0),
            );
          }
          return enrichWithJordanTime({
            id: r.id,
            orderType: 'arheb_box',
            storeName: 'Arheb Box',
            name: r.userName,
            phoneNumber: r.phoneNumber,
            // Same meaning as store rows: line-item / subtotal before delivery (parcel declared value).
            totalAmount: parcelAmount,
            deliveryFee: enriched.deliveryFee,
            serviceFee: enriched.serviceFee,
            feesTax: enriched.feesTax,
            status: r.status,
            paymentType: r.paymentMethod || 'cash',
            driverId: r.driverId,
            driverName: r.driverName,
            createdAt: r.createdAt,
            pickup: enriched.pickup,
            dropoff: enriched.dropoff,
            receiverPhone: enriched.receiverPhone,
            receiverName: enriched.receiverName,
            whoPays: enriched.whoPays,
            amount: enriched.amount,
            weightKg: enriched.weightKg,
            distanceKm: enriched.distanceKm,
            notes: r.notes,
            invoice: enriched.invoice,
            items: [],
            driverEarningsJod,
            deliveryNetAfterDriverJod,
          }, ['createdAt']);
        });
      } catch (e) { /* table may not exist yet */ }
    }

    const merged = [...storeOrders, ...boxOrders];
    merged.sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime();
      const db2 = new Date(b.createdAt || 0).getTime();
      if (db2 !== da) return db2 - da;
      return (b.id || 0) - (a.id || 0);
    });
    return { orders: merged, dateRange: range };
  }

  app.get('/api/admin/orders', auth, (req, res) => {
    const { orders: withItems, dateRange } = buildAdminOrdersList(req);
    return res.status(200).json({ success: true, data: { orders: withItems, dateRange } });
  });

  app.get('/api/admin/orders/export', auth, (req, res) => {
    try {
      const { orders: withItems } = buildAdminOrdersList(req);
      const rows = withItems.map((o) => ({
        id: o.id,
        createdAt: o.createdAt,
        createdAtJordan: o.createdAtJordan ?? '',
        status: o.status,
        storeName: o.storeName,
        name: o.name,
        phoneNumber: o.phoneNumber,
        totalAmount: o.totalAmount,
        deliveryFee: o.deliveryFee ?? '',
        paymentType: o.paymentType,
        driverName: o.driverName || '',
        notes: o.notes != null && String(o.notes).trim() !== '' ? String(o.notes).trim() : '',
        itemsSummary: (o.items || [])
          .map((i) => {
            const add = formatOrderItemAddOnsSummary(i);
            return `${i.name} x${i.quantity}` + (add ? ` [${add}]` : '');
          })
          .join('; '),
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="orders-export.xlsx"');
      return res.send(buf);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: 'Export failed' });
    }
  });

  // ——— Get single order (full details for admin) ———
  app.get('/api/admin/orders/:orderId', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });

    if (req.query.type === 'arheb_box') {
      try {
        const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(orderId);
        if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
        const enriched = enrichArhebBoxRow(row, db);
        return res.status(200).json({ success: true, data: { order: { ...enriched, orderType: 'arheb_box', storeName: 'Arheb Box', paymentType: row.paymentMethod || 'cash' } } });
      } catch (e) {
        return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      }
    }

    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && !sameStoreId(order.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const items = findOrderItems.all(orderId);
    const storesList = loadStores();
    const store = order.storeId ? storesList.find((s) => String(s.id) === String(order.storeId)) : null;
    const storeName = store ? (store.nameEn || store.name || store.nameAr) : (order.storeId || '-');
    return res.status(200).json({
      success: true,
      data: {
        order: enrichWithJordanTime(
          {
            ...order,
            orderType: 'store',
            storeName,
            storeAddress: store ? (store.addressEn || store.address || store.addressAr || null) : null,
            storeMapsUrl: store ? (store.mapsUrl || null) : null,
            storeLatitude: store?.latitude ?? store?.lat ?? null,
            storeLongitude: store?.longitude ?? store?.long ?? null,
            items: mapOrderItemsForAdmin(items),
          },
          ['createdAt'],
        ),
      },
    });
  });

  app.patch('/api/admin/orders/:orderId/status', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && !sameStoreId(order.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const currentStatusLower = String(order.status || '').trim().toLowerCase();
    if (currentStatusLower === 'cancelled' && req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({
        success: false,
        message:
          'Cancelled orders cannot be changed. Only SuperAdmin can change status to restore a previous phase.',
      });
    }
    const { status } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    const nextStatus = status.trim();
    const nextKey = normalizeOrderStatusKey(nextStatus);

    if (req.admin.role === ROLES.STORE_ADMIN) {
      if (nextKey === 'cancelled') {
        if (!storeAdminMayCancelOrder(order.status)) {
          return res.status(403).json({
            success: false,
            message:
              'Store admins can only cancel before the order is confirmed for preparation. After that, move the order forward (e.g. Preparing → On the way) or contact Admin/SuperAdmin.',
          });
        }
      } else {
        const allowed = storeAdminAllowedNextStatuses(order.status);
        const ok = allowed.some((a) => normalizeOrderStatusKey(a) === nextKey);
        if (!ok) {
          return res.status(403).json({
            success: false,
            message:
              'Store admins can only advance the order one step in the flow (for example Waiting confirmation → Preparing). To cancel, use Reject only while the order is still awaiting confirmation or payment.',
          });
        }
      }
    }

    if (req.admin.role !== ROLES.SUPERADMIN && isBackwardOrderStatusTransition(order.status, nextStatus)) {
      return res.status(403).json({
        success: false,
        message: 'Only SuperAdmin can move an order to an earlier status or reopen a completed order',
      });
    }
    if (nextStatus.toLowerCase() === 'on the way') {
      db.prepare('UPDATE orders SET status = ?, nearArrivalNotified = 0 WHERE id = ?').run(nextStatus, orderId);
    } else {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(nextStatus, orderId);
    }
    try {
      const { emitOrderEvent } = require('../order');
      if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status: nextStatus });
    } catch (e) { /* ignore */ }
    let updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    notifyCustomerOrderStatusChange(db, order, orderId, nextStatus);

    // One driver at a time (nearest online → FCM); 20s timeout advances to next nearest (see sequentialDriverOffer).
    if (nextKey === 'preparing' && updated.driverId == null && io) {
      try {
        const next = offerNextSequentialDriver(db, io, orderId, updated, offerCtx);
        if (next) {
          const { broadcastDriverOrdersUpdated } = require('../driverPresence');
          broadcastDriverOrdersUpdated(io, { type: 'new_request', orderId });
        }
      } catch (e) {
        /* ignore */
      }
    }

    if (nextStatus.toLowerCase() === 'delivered') {
      if (isEinvoicePaused(db)) {
        try {
          db.prepare(`UPDATE orders SET einvoiceStatus = 'paused', einvoiceError = ? WHERE id = ?`).run('E-invoice submissions are paused', orderId);
        } catch (e) { /* ignore */ }
      } else {
        const { submitJofotaraInvoice } = require('../jofotara');
        submitJofotaraInvoice(db, orderId).catch((e) => {
          console.error(`[jofotara] Async submission failed for order ${orderId}:`, e.message || e);
        });
      }
    }

    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      broadcastDriverOrdersUpdated(io, { type: 'status_change', orderId, status: nextStatus });
    } catch (e) { /* ignore */ }

    logActivity(db, req, {
      action: 'edit',
      resourceType: 'order',
      resourceId: String(orderId),
      storeScopeId: order.storeId != null ? String(order.storeId) : null,
      summary: `Order #${orderId} status ${order.status} → ${nextStatus}`,
      details: { from: order.status, to: nextStatus },
    });
    return res.status(200).json({
      success: true,
      data: {
        order: {
          ...updated,
          items: mapOrderItemsForAdmin(items),
        },
      },
    });
  });

  // ——— Reject order (cancel): Store Admin can reject when status is Waiting confirmation; order is set to Cancelled ———
  app.post('/api/admin/orders/:orderId/reject', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && (order.storeId == null || !sameStoreId(order.storeId, req.admin.storeId))) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    if (req.admin.role === ROLES.STORE_ADMIN) {
      if (!storeAdminMayCancelOrder(order.status)) {
        return res.status(403).json({
          success: false,
          message:
            'Store admins can only reject (cancel) while the order is Pending payment, Waiting cliq confirmation, or Waiting confirmation. After the order is confirmed for preparation, use the next status steps only.',
        });
      }
    } else {
      const statusLower = (order.status || '').toLowerCase();
      if (
        !statusLower.includes('waiting') &&
        !statusLower.includes('confirmation') &&
        !statusLower.includes('pending payment')
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Order can only be rejected when status is Pending payment, Waiting confirmation, or Waiting cliq confirmation',
        });
      }
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('Cancelled', orderId);
    try {
      const { emitOrderEvent } = require('../order');
      if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status: 'Cancelled' });
    } catch (e) { /* ignore */ }
    notifyCustomerOrderStatusChange(db, order, orderId, 'Cancelled');
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'order',
      resourceId: String(orderId),
      storeScopeId: order.storeId != null ? String(order.storeId) : null,
      summary: `Order #${orderId} rejected → Cancelled`,
      details: { from: order.status, to: 'Cancelled' },
    });
    return res.status(200).json({
      success: true,
      data: {
        order: {
          ...updated,
          items: mapOrderItemsForAdmin(items),
        },
      },
    });
  });

  // ——— Delete order permanently (SuperAdmin only) ———
  app.delete('/api/admin/orders/:orderId', auth, (req, res) => {
    if (req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Only SuperAdmin can delete orders' });
    }
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    try {
      db.prepare('DELETE FROM order_items WHERE orderId = ?').run(orderId);
      db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
      try { db.prepare('DELETE FROM driver_requests WHERE orderId = ?').run(orderId); } catch (e) { /* table may not exist */ }
      try { db.prepare('DELETE FROM payment_transactions WHERE orderId = ?').run(orderId); } catch (e) { /* ignore */ }
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to delete order' });
    }
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'order',
      resourceId: String(orderId),
      storeScopeId: order.storeId != null ? String(order.storeId) : null,
      summary: `Order #${orderId} deleted permanently`,
    });
    return res.status(200).json({ success: true, message: `Order #${orderId} deleted permanently` });
  });

  // ——— Get available drivers for assigning to an order (Admin / SuperAdmin only) ———
  app.get('/api/admin/orders/:orderId/available-drivers', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && !sameStoreId(order.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    let drivers = [];
    try {
      drivers = db.prepare('SELECT id, name, mobile, vehicleType, vehicleNumber FROM drivers WHERE isBlocked = 0 ORDER BY name').all();
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const pendingDriverIds = new Set();
    try {
      const pending = db.prepare('SELECT driverId FROM driver_requests WHERE orderId = ? AND status = ?').all(orderId, 'pending');
      pending.forEach((r) => pendingDriverIds.add(r.driverId));
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const list = drivers
      .filter((d) => !pendingDriverIds.has(d.id))
      .map((d) => ({ id: d.id, name: d.name, mobile: d.mobile, vehicleType: d.vehicleType || null, vehicleNumber: d.vehicleNumber || null }));
    return res.status(200).json({ success: true, data: { drivers: list } });
  });

  // ——— Get nearby active drivers for an order (presence + distance to store; Admin / SuperAdmin only) ———
  app.get('/api/admin/orders/:orderId/nearby-drivers', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && !sameStoreId(order.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    let drivers = [];
    try {
      drivers = db.prepare('SELECT id, name, mobile, vehicleType, vehicleNumber FROM drivers WHERE isBlocked = 0 ORDER BY name').all();
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const pendingDriverIds = new Set();
    try {
      const pending = db.prepare('SELECT driverId FROM driver_requests WHERE orderId = ? AND status = ?').all(orderId, 'pending');
      pending.forEach((r) => pendingDriverIds.add(r.driverId));
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const candidateIds = drivers.filter((d) => !pendingDriverIds.has(d.id)).map((d) => d.id);
    const stores = loadStores();
    const store = order.storeId ? stores.find((s) => String(s.id) === String(order.storeId)) : null;
    const parsed = parseLatLongFromGoogleMapsUrl(store?.mapsUrl);
    const storeLat = store && (store.latitude != null || store.lat != null) ? Number(store.latitude ?? store.lat) : (parsed?.latitude ?? null);
    const storeLong = store && (store.longitude != null || store.long != null) ? Number(store.longitude ?? store.long) : (parsed?.longitude ?? null);
    const withDistance = getActiveFromListWithDistance(candidateIds, storeLat, storeLong);
    const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
    const list = withDistance.map((d) => ({
      ...driverById[d.driverId],
      id: d.driverId,
      latitude: d.latitude,
      longitude: d.longitude,
      lastSeen: d.lastSeen,
      distanceKm: d.distanceKm,
    }));
    return res.status(200).json({ success: true, data: { drivers: list } });
  });

  // ——— All drivers for manual assign UI (Admin / SuperAdmin): online + distance first, then offline ———
  app.get('/api/admin/orders/:orderId/assignable-drivers', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    let drivers = [];
    try {
      drivers = db.prepare('SELECT id, name, mobile, vehicleType, vehicleNumber FROM drivers WHERE isBlocked = 0 ORDER BY name').all();
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const stores = loadStores();
    const store = order.storeId ? stores.find((s) => String(s.id) === String(order.storeId)) : null;
    const parsed = parseLatLongFromGoogleMapsUrl(store?.mapsUrl);
    const storeLat =
      store && (store.latitude != null || store.lat != null) ? Number(store.latitude ?? store.lat) : (parsed?.latitude ?? null);
    const storeLong =
      store && (store.longitude != null || store.long != null) ? Number(store.longitude ?? store.long) : (parsed?.longitude ?? null);
    const candidateIds = drivers.map((d) => d.id);
    const withDistance = getActiveFromListWithDistance(candidateIds, storeLat, storeLong);
    const onlineIds = new Set(withDistance.map((d) => d.driverId));
    const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
    const onlineList = withDistance.map((d) => ({
      ...driverById[d.driverId],
      id: d.driverId,
      online: true,
      latitude: d.latitude,
      longitude: d.longitude,
      lastSeen: d.lastSeen,
      distanceKm: d.distanceKm,
    }));
    const offlineList = drivers
      .filter((d) => !onlineIds.has(d.id))
      .map((d) => ({
        ...d,
        id: d.id,
        online: false,
        latitude: null,
        longitude: null,
        lastSeen: null,
        distanceKm: null,
      }));
    return res.status(200).json({
      success: true,
      data: {
        drivers: [...onlineList, ...offlineList],
        storeLocation: storeLat != null && storeLong != null ? { latitude: storeLat, longitude: storeLong } : null,
      },
    });
  });

  // ——— Request nearest online driver (one at a time; 20s then next nearest). Admin / SuperAdmin only ———
  app.post('/api/admin/orders/:orderId/request-driver', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const statusLower = (order.status || '').toLowerCase();
    if (!statusLower.includes('preparing')) {
      return res.status(400).json({ success: false, message: 'Can only request driver when order is Preparing' });
    }
    if (order.driverId != null) {
      return res.status(400).json({ success: false, message: 'Order already has a driver assigned' });
    }
    const pendingN = countPendingDriverRequests(db, orderId);
    if (pendingN > 0) {
      return res.status(400).json({
        success: false,
        message: 'A driver request is already pending for this order. Wait for accept/reject or assign manually.',
      });
    }
    const next = offerNextSequentialDriver(db, io, orderId, order, offerCtx);
    if (!next) {
      return res.status(400).json({
        success: false,
        message:
          'No driver could be notified (no online drivers / all candidates already tried). Drivers should open the app and connect, or assign manually.',
      });
    }
    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      broadcastDriverOrdersUpdated(io, { type: 'new_request', orderId });
    } catch (e) {
      /* ignore */
    }
    return res.status(200).json({
      success: true,
      message: `Request sent to nearest available driver (#${next.driverId}). Next driver is tried if they do not accept within 20 seconds.`,
      data: { orderId, driverId: next.driverId, distanceKm: next.distanceKm ?? null },
    });
  });

  // ——— Auto-assign: nearest online driver first (Admin / SuperAdmin only for manual trigger) ———
  app.post('/api/admin/orders/:orderId/auto-assign', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && !sameStoreId(order.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const statusLower = (order.status || '').toLowerCase();
    if (!statusLower.includes('preparing')) {
      return res.status(400).json({ success: false, message: 'Can only auto-assign when order is Preparing' });
    }
    if (order.driverId != null) {
      return res.status(400).json({ success: false, message: 'Order already has a driver assigned' });
    }
    const autoAssignResult = runDeliveryClusterAutoAssign(db, io, order.storeId, offerCtx);
    const hit = autoAssignResult.assigned.find((x) => x.orderId === orderId);
    if (!hit) {
      const still = findOrderById.get(orderId);
      const reason = still?.driverAssignmentStatus === 'no_driver_online' ? 'no_driver_online' : 'no_match';
      return res.status(404).json({
        success: false,
        message:
          reason === 'no_driver_online'
            ? 'No online drivers available for this store. Drivers must connect to the app and share location.'
            : 'Could not assign a driver (check delivery coordinates and driver availability).',
        data: { orderId, autoAssign: autoAssignResult, driverAssignmentStatus: still?.driverAssignmentStatus ?? null },
      });
    }
    const updated = findOrderById.get(orderId);
    return res.status(200).json({
      success: true,
      message: 'Driver assigned automatically (clustered by delivery distance, max 1 km between consecutive stops).',
      data: { orderId, driverId: hit.driverId, order: updated, autoAssign: autoAssignResult },
    });
  });

  // ——— Assign a specific driver to a store order (Admin / SuperAdmin). Same FCM/socket as cluster assign. ———
  app.post('/api/admin/orders/:orderId/assign-driver', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const { driverId } = req.body || {};
    const driverIdNum = driverId != null ? parseInt(String(driverId), 10) : NaN;
    if (!driverIdNum || isNaN(driverIdNum)) {
      return res.status(400).json({ success: false, message: 'driverId is required' });
    }
    const statusLower = String(order.status || '').trim().toLowerCase();
    if (!statusLower.includes('preparing')) {
      return res.status(400).json({ success: false, message: 'Can only assign when order is Preparing' });
    }
    if (order.driverId != null && Number(order.driverId) !== driverIdNum) {
      return res.status(400).json({
        success: false,
        message: 'Order already has a different driver. Clear assignment first if reassignment is required.',
      });
    }
    if (order.driverId != null && Number(order.driverId) === driverIdNum) {
      const updatedSame = findOrderById.get(orderId);
      const itemsSame = findOrderItems.all(orderId);
      return res.status(200).json({
        success: true,
        message: 'Already assigned to this driver',
        data: { order: { ...updatedSame, items: mapOrderItemsForAdmin(itemsSame) } },
      });
    }
    const driver = db.prepare('SELECT id, name FROM drivers WHERE id = ? AND isBlocked = 0').get(driverIdNum);
    if (!driver) return res.status(400).json({ success: false, message: 'Invalid or blocked driver' });
    clearStoreOrderOfferTimeout(orderId);
    rejectAllPendingDriverRequestsForStoreOrder(db, orderId);
    assignDriverToOrder(db, orderId, driverIdNum, driver.name, 'In progress');
    try {
      const { emitOrderEvent } = require('../order');
      const updatedAfterAssign = findOrderById.get(orderId);
      if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status: updatedAfterAssign?.status || 'In progress' });
    } catch (e) { /* ignore */ }
    const updated = findOrderById.get(orderId);
    const stores = loadStores();
    const store = updated.storeId ? stores.find((s) => String(s.id) === String(updated.storeId)) : null;
    notifyDriverAssigned(db, io, orderId, updated, driverIdNum, store);
    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      broadcastDriverOrdersUpdated(io, { type: 'order_accepted', orderId, driverId: driverIdNum });
    } catch (e) { /* ignore */ }
    fcm
      .sendToUserByPhone(
        db,
        updated.phoneNumber,
        'Driver assigned',
        `A driver has been assigned to Order #${orderId}.`,
        null,
        customerOrderTrackingData(orderId, updated.status || 'In progress'),
      )
      .catch(() => {});
    const items = findOrderItems.all(orderId);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'order',
      resourceId: String(orderId),
      storeScopeId: order.storeId != null ? String(order.storeId) : null,
      summary: `Order #${orderId}: assigned driver ${driverIdNum}`,
      details: { driverId: driverIdNum },
    });
    return res.status(200).json({
      success: true,
      message: 'Driver assigned. They have been notified in the driver app.',
      data: { orderId, driverId: driverIdNum, order: { ...updated, items: mapOrderItemsForAdmin(items) } },
    });
  });

  /** Change driver on an order that already has one (Admin / SuperAdmin). */
  app.post('/api/admin/orders/:orderId/reassign-driver', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const { driverId } = req.body || {};
    const driverIdNum = driverId != null ? parseInt(String(driverId), 10) : NaN;
    if (!driverIdNum || isNaN(driverIdNum)) {
      return res.status(400).json({ success: false, message: 'driverId is required' });
    }
    const statusLower = String(order.status || '').trim().toLowerCase();
    const canReassignStatus =
      statusLower.includes('preparing') ||
      statusLower.includes('being prepared') ||
      statusLower.includes('on the way') ||
      statusLower.includes('driver to pick') ||
      statusLower.includes('in progress');
    if (!canReassignStatus) {
      return res.status(400).json({
        success: false,
        message: 'Can only reassign when order is Preparing, Being prepared, In progress, Driver to pick, or On the way',
      });
    }
    if (order.driverId != null && Number(order.driverId) === driverIdNum) {
      const updatedSame = findOrderById.get(orderId);
      const itemsSame = findOrderItems.all(orderId);
      return res.status(200).json({
        success: true,
        message: 'Already assigned to this driver',
        data: { order: { ...updatedSame, items: mapOrderItemsForAdmin(itemsSame) } },
      });
    }
    const oldDriverId = order.driverId != null ? Number(order.driverId) : null;
    const driver = db.prepare('SELECT id, name FROM drivers WHERE id = ? AND isBlocked = 0').get(driverIdNum);
    if (!driver) return res.status(400).json({ success: false, message: 'Invalid or blocked driver' });
    const keepStatus = order.status || 'Preparing';
    clearStoreOrderOfferTimeout(orderId);
    rejectAllPendingDriverRequestsForStoreOrder(db, orderId);
    assignDriverToOrder(db, orderId, driverIdNum, driver.name, keepStatus);
    try {
      const { emitOrderEvent } = require('../order');
      if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status: keepStatus });
    } catch (e) {
      /* ignore */
    }
    const updated = findOrderById.get(orderId);
    const stores = loadStores();
    const store = updated.storeId ? stores.find((s) => String(s.id) === String(updated.storeId)) : null;
    notifyDriverAssigned(db, io, orderId, updated, driverIdNum, store);
    try {
      const { broadcastDriverOrdersUpdated } = require('../driverPresence');
      // Live driver app only understands existing orders_updated types — mirror reject + accept.
      if (oldDriverId && oldDriverId !== driverIdNum) {
        broadcastDriverOrdersUpdated(io, { type: 'request_rejected', orderId, driverId: oldDriverId });
      }
      broadcastDriverOrdersUpdated(io, { type: 'order_accepted', orderId, driverId: driverIdNum });
    } catch (e) {
      /* ignore */
    }
    if (oldDriverId && oldDriverId !== driverIdNum) {
      fcm
        .sendToDriver(
          db,
          oldDriverId,
          'Order reassigned',
          `Order #${orderId} was assigned to another driver.`,
          { type: 'request_rejected', orderId: String(orderId), driverId: String(oldDriverId) },
        )
        .catch(() => {});
    }
    fcm
      .sendToUserByPhone(
        db,
        updated.phoneNumber,
        'Driver update',
        `A new driver is handling Order #${orderId}.`,
        null,
        customerOrderTrackingData(orderId, updated.status || keepStatus),
      )
      .catch(() => {});
    const items = findOrderItems.all(orderId);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'order',
      resourceId: String(orderId),
      storeScopeId: order.storeId != null ? String(order.storeId) : null,
      summary: `Order #${orderId}: reassigned driver → ${driverIdNum}`,
      details: { driverId: driverIdNum, previousDriverId: oldDriverId },
    });
    return res.status(200).json({
      success: true,
      message: 'Driver reassigned.',
      data: { orderId, driverId: driverIdNum, order: { ...updated, items: mapOrderItemsForAdmin(items) } },
    });
  });

  // ——— Get order tracking state (for dashboard live map; Store Admin / Admin / SuperAdmin) ———
  app.get('/api/admin/orders/:orderId/tracking', auth, (req, res) => {
    const paramId = parseInt(req.params.orderId, 10);
    if (isNaN(paramId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });

    if (req.query.type === 'arheb_box') {
      let boxRow;
      try {
        boxRow = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(paramId);
      } catch (e) {
        boxRow = null;
      }
      if (!boxRow) return res.status(404).json({ success: false, message: 'Arheb Box request not found' });
      let getArhebBoxTrackingState;
      try {
        getArhebBoxTrackingState = require('../order').getArhebBoxTrackingState;
      } catch (e) {
        getArhebBoxTrackingState = null;
      }
      const tracking = getArhebBoxTrackingState ? getArhebBoxTrackingState(paramId) : null;
      const lastLocation = tracking?.lastLocation || null;
      return res.status(200).json({
        success: true,
        data: {
          requestId: paramId,
          orderType: 'arheb_box',
          orderStatus: boxRow.status,
          driverId: boxRow.driverId,
          driverName: boxRow.driverName,
          isTracking: !!lastLocation,
          driverConnected: !!(tracking && tracking.driverSocket),
          lastLocation: lastLocation
            ? {
                latitude: lastLocation.latitude,
                longitude: lastLocation.longitude,
                timestamp: lastLocation.timestamp,
              }
            : null,
          trackFrom: 'arheb_box_in_progress',
        },
      });
    }

    const order = findOrderById.get(paramId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && !sameStoreId(order.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    let getOrderTrackingState;
    try {
      getOrderTrackingState = require('../order').getOrderTrackingState;
    } catch (e) {
      getOrderTrackingState = null;
    }
    const tracking = getOrderTrackingState ? getOrderTrackingState(paramId) : null;
    const lastLocation = tracking?.lastLocation || null;
    return res.status(200).json({
      success: true,
      data: {
        orderId: paramId,
        orderType: 'store',
        orderStatus: order.status,
        driverId: order.driverId,
        driverName: order.driverName,
        isTracking: !!lastLocation,
        driverConnected: !!(tracking && tracking.driverSocket),
        lastLocation: lastLocation ? {
          latitude: lastLocation.latitude,
          longitude: lastLocation.longitude,
          timestamp: lastLocation.timestamp,
        } : null,
        trackFrom: 'driver_accept_until_delivery',
      },
    });
  });

  // ——— Driver + map payload for dashboard (track button: mapPreviewUrl + live location) ———
  app.get('/api/admin/orders/:orderId/driver-map', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && !sameStoreId(order.storeId, req.admin.storeId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const storesList = loadStores();
    const store = order.storeId ? storesList.find((s) => String(s.id) === String(order.storeId)) : null;
    const parsed = parseLatLongFromGoogleMapsUrl(store?.mapsUrl);
    const storeLat = store && (store.latitude != null || store.lat != null) ? Number(store.latitude ?? store.lat) : (parsed?.latitude ?? null);
    const storeLong = store && (store.longitude != null || store.long != null) ? Number(store.longitude ?? store.long) : (parsed?.longitude ?? null);
    const dLat = Number(order.addressLat);
    const dLng = Number(order.addressLong);
    let driverDetail = null;
    let liveLocation = null;
    if (order.driverId != null) {
      try {
        driverDetail = db.prepare('SELECT id, name, mobile, vehicleType, vehicleNumber, photo FROM drivers WHERE id = ?').get(order.driverId);
      } catch (e) {
        driverDetail = null;
      }
      const active = getActiveDriversWithLocation();
      const hit = active.find((x) => Number(x.driverId) === Number(order.driverId));
      if (hit && hit.latitude != null && hit.longitude != null) {
        liveLocation = { latitude: hit.latitude, longitude: hit.longitude, lastSeen: hit.lastSeen };
      }
    }
    let getOrderTrackingState;
    try {
      getOrderTrackingState = require('../order').getOrderTrackingState;
    } catch (e) {
      getOrderTrackingState = null;
    }
    const tracking = getOrderTrackingState ? getOrderTrackingState(orderId) : null;
    const lastLocation = tracking?.lastLocation || null;
    const parts = [];
    if (Number.isFinite(storeLat) && Number.isFinite(storeLong)) parts.push(`${storeLat},${storeLong}`);
    if (Number.isFinite(dLat) && Number.isFinite(dLng)) parts.push(`${dLat},${dLng}`);
    if (liveLocation && Number.isFinite(liveLocation.latitude) && Number.isFinite(liveLocation.longitude)) {
      parts.push(`${liveLocation.latitude},${liveLocation.longitude}`);
    }
    const mapPreviewUrl = parts.length >= 2 ? `https://www.google.com/maps/dir/${parts.map(encodeURIComponent).join('/')}` : null;

    return res.status(200).json({
      success: true,
      data: {
        orderId,
        orderStatus: order.status,
        driverAssignmentStatus: order.driverAssignmentStatus ?? null,
        driverSearchStartedAt: order.driverSearchStartedAt ?? null,
        deliveryLocation:
          Number.isFinite(dLat) && Number.isFinite(dLng) ? { latitude: dLat, longitude: dLng } : null,
        storeLocation:
          Number.isFinite(storeLat) && Number.isFinite(storeLong) ? { latitude: storeLat, longitude: storeLong } : null,
        storeName: store ? store.nameEn || store.name || store.nameAr : null,
        driver: driverDetail
          ? {
              id: driverDetail.id,
              name: driverDetail.name,
              mobile: driverDetail.mobile,
              vehicleType: driverDetail.vehicleType,
              vehicleNumber: driverDetail.vehicleNumber,
              photo: driverDetail.photo,
              liveLocation,
            }
          : null,
        tracking: {
          isTracking: !!lastLocation,
          driverConnected: !!(tracking && tracking.driverSocket),
          lastLocation: lastLocation
            ? {
                latitude: lastLocation.latitude,
                longitude: lastLocation.longitude,
                timestamp: lastLocation.timestamp,
              }
            : null,
        },
        mapPreviewUrl,
      },
    });
  });

  // ——— Live active drivers map (Aqaba dashboard) ———
  app.get('/api/admin/drivers/active-map', auth, requireAdminOrSuper, (req, res) => {
    try {
      const active = getActiveDriversWithLocation();
      let driversMeta = [];
      try {
        driversMeta = db.prepare('SELECT id, name, mobile, vehicleType, vehicleNumber FROM drivers WHERE isBlocked = 0').all();
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }
      const metaById = Object.fromEntries(driversMeta.map((d) => [Number(d.id), d]));
      // Include every non-stale presence entry. Drivers who connected but have not sent
      // `location` yet appear with hasLocation: false (dashboard can still list them).
      const activeStoreOrders = db.prepare(
        `SELECT id FROM orders WHERE driverId = ? AND status NOT IN ('Delivered', 'Cancelled') ORDER BY id DESC LIMIT 25`,
      );
      const activeArhebBox = (() => {
        try {
          return db.prepare(
            `SELECT id FROM arheb_box_requests WHERE driverId = ? AND lower(trim(status)) NOT IN ('delivered', 'cancelled') ORDER BY id DESC LIMIT 1`,
          );
        } catch (e) {
          return null;
        }
      })();

      const drivers = active.map((d) => {
        const latNum = d.latitude != null ? Number(d.latitude) : NaN;
        const lonNum = d.longitude != null ? Number(d.longitude) : NaN;
        const hasLocation =
          Number.isFinite(latNum) &&
          Number.isFinite(lonNum) &&
          latNum >= -90 &&
          latNum <= 90 &&
          lonNum >= -180 &&
          lonNum <= 180;
        let currentStoreOrderId = null;
        let currentArhebBoxRequestId = null;
        let currentStoreOrderIds = [];
        try {
          const so = activeStoreOrders.all(d.driverId);
          currentStoreOrderIds = (so || []).map((r) => r.id);
          currentStoreOrderId = currentStoreOrderIds[0] ?? null;
        } catch (e) {
          currentStoreOrderId = null;
        }
        if (activeArhebBox) {
          try {
            const bx = activeArhebBox.get(d.driverId);
            currentArhebBoxRequestId = bx?.id ?? null;
          } catch (e) {
            /* ignore */
          }
        }
        return {
          id: d.driverId,
          name: metaById[d.driverId]?.name || null,
          mobile: metaById[d.driverId]?.mobile || null,
          vehicleType: metaById[d.driverId]?.vehicleType || null,
          vehicleNumber: metaById[d.driverId]?.vehicleNumber || null,
          latitude: hasLocation ? latNum : null,
          longitude: hasLocation ? lonNum : null,
          hasLocation,
          lastSeen: d.lastSeen,
          currentStoreOrderId,
          currentStoreOrderIds,
          currentArhebBoxRequestId,
        };
      });
      return res.status(200).json({
        success: true,
        data: {
          city: 'Aqaba',
          center: { latitude: 29.5321, longitude: 35.0063 },
          activeDriversCount: drivers.length,
          driversWithLocationCount: drivers.filter((x) => x.hasLocation).length,
          drivers,
        },
      });
    } catch (e) {
      console.error('Active drivers map error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load active drivers map' });
    }
  });

  // ——— Delete order (Admin and SuperAdmin only; order_items removed by CASCADE) ———
  app.delete('/api/admin/orders/:orderId', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    db.prepare('DELETE FROM order_items WHERE orderId = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'order',
      resourceId: String(orderId),
      storeScopeId: order.storeId != null ? String(order.storeId) : null,
      summary: `Deleted order #${orderId}`,
    });
    return res.status(200).json({ success: true, message: 'Order deleted' });
  });

  // ——— Notifications table (history of broadcast notifications) ———
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT,
        imageUrl TEXT,
        successCount INTEGER,
        failureCount INTEGER,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) throw e;
  }

  // ——— Send broadcast notification to all registered app users (Admin / SuperAdmin) ———
  app.post('/api/admin/notifications/broadcast', auth, requireAdminOrSuper, async (req, res) => {
    const { title, body, imageUrl } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }
    const bodyStr = typeof body === 'string' ? body : (body != null ? String(body) : '');
    const image = typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null;
    try {
      const result = await fcm.sendToAllUsers(db, title.trim(), bodyStr, image, { type: 'broadcast' });
      const successCount = result.successCount ?? 0;
      const failureCount = result.failureCount ?? 0;
      try {
        db.prepare(
          'INSERT INTO notifications (title, body, imageUrl, successCount, failureCount) VALUES (?, ?, ?, ?, ?)'
        ).run(title.trim(), bodyStr || null, image, successCount, failureCount);
      } catch (insertErr) {
        if (!insertErr.message || !insertErr.message.includes('no such table')) console.error('Notifications insert:', insertErr);
      }
      logActivity(db, req, {
        action: 'add',
        resourceType: 'notification_broadcast',
        resourceId: null,
        storeScopeId: null,
        summary: `Broadcast notification: ${title.trim().slice(0, 80)}`,
        details: { successCount, failureCount },
      });
      return res.status(200).json({
        success: true,
        message: 'Broadcast notification sent',
        data: { successCount, failureCount },
      });
    } catch (e) {
      console.error('Broadcast notification error:', e);
      return res.status(500).json({ success: false, message: 'Failed to send broadcast notification' });
    }
  });

  // ——— Send FCM test to a single device token (SuperAdmin only) ———
  app.post('/api/admin/notifications/fcm-test', auth, requireSuperAdmin, async (req, res) => {
    const { fcmToken, title, body, imageUrl } = req.body || {};
    if (!fcmToken || typeof fcmToken !== 'string' || !fcmToken.trim()) {
      return res.status(400).json({ success: false, message: 'fcmToken is required' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }
    const bodyStr = typeof body === 'string' ? body : body != null ? String(body) : '';
    const image = typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null;
    try {
      const messageId = await fcm.sendToToken(
        fcmToken.trim(),
        title.trim(),
        bodyStr,
        image,
        { type: 'admin_fcm_test', click_action: 'FLUTTER_NOTIFICATION_CLICK' },
        { db },
      );
      if (!messageId) {
        return res.status(502).json({
          success: false,
          message:
            'FCM did not return a message id (invalid/expired token, wrong Firebase project, or Firebase not configured)',
          data: { messageId: null },
        });
      }
      logActivity(db, req, {
        action: 'add',
        resourceType: 'notification_fcm_test',
        resourceId: null,
        storeScopeId: null,
        summary: `FCM test push sent (token prefix ${fcmToken.trim().slice(0, 10)}…)`,
        details: { messageId },
      });
      return res.status(200).json({
        success: true,
        message: 'Test notification sent',
        data: { messageId },
      });
    } catch (e) {
      console.error('FCM test notification error:', e);
      return res.status(500).json({ success: false, message: 'Failed to send test notification' });
    }
  });

  // ——— List all notifications (Admin / SuperAdmin) ———
  app.get('/api/admin/notifications', auth, requireAdminOrSuper, (req, res) => {
    try {
      const rows = db.prepare(
        'SELECT id, title, body, imageUrl, successCount, failureCount, createdAt FROM notifications ORDER BY createdAt DESC, id DESC'
      ).all();
      return res.status(200).json({ success: true, data: { notifications: rows } });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { notifications: [] } });
      }
      console.error('Notifications list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list notifications' });
    }
  });

  // ——— Dashboard sales (and for Admin/SuperAdmin: open/closed store counts) ———
  app.get('/api/admin/dashboard/sales', auth, (req, res) => {
    const range = resolveOrdersListDateRange(req.query || {});
    const storeConds = [];
    const storeParams = [];
    if (req.admin.role === ROLES.STORE_ADMIN) {
      storeConds.push('(CAST(storeId AS TEXT) = ? OR storeId IS NULL)');
      storeParams.push(String(req.admin.storeId));
    }
    if (!range.allDates && range.dateFrom) {
      storeConds.push('date(createdAt) >= date(?)');
      storeParams.push(range.dateFrom);
    }
    if (!range.allDates && range.dateTo) {
      storeConds.push('date(createdAt) <= date(?)');
      storeParams.push(range.dateTo);
    }
    const storeWhere = storeConds.length ? ' WHERE ' + storeConds.join(' AND ') : '';
    const orders = db.prepare('SELECT * FROM orders' + storeWhere).all(...storeParams);

    let boxRows = [];
    if (req.admin.role === ROLES.ADMIN || req.admin.role === ROLES.SUPERADMIN) {
      try {
        const bc = [];
        const bp = [];
        if (!range.allDates && range.dateFrom) {
          bc.push('date(createdAt) >= date(?)');
          bp.push(range.dateFrom);
        }
        if (!range.allDates && range.dateTo) {
          bc.push('date(createdAt) <= date(?)');
          bp.push(range.dateTo);
        }
        const bw = bc.length ? ' WHERE ' + bc.join(' AND ') : '';
        boxRows = db.prepare('SELECT * FROM arheb_box_requests' + bw).all(...bp);
      } catch (e) {
        boxRows = [];
      }
    }

    const totalRevenueStore = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalRevenueBox = boxRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalRevenue = totalRevenueStore + totalRevenueBox;

    const byStatus = {};
    orders.forEach((o) => {
      const s = o.status || 'Unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    boxRows.forEach((r) => {
      const s = r.status || 'Unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });

    const recentMerged = [
      ...orders.map((o) => ({ kind: 'store', o })),
      ...boxRows.map((o) => ({ kind: 'box', o })),
    ];
    recentMerged.sort((a, b) => new Date(b.o.createdAt || 0) - new Date(a.o.createdAt || 0));
    const recent = recentMerged.slice(0, 50).map((item) => {
      if (item.kind === 'store') {
        const o = item.o;
        return enrichWithJordanTime(
          {
            id: o.id,
            totalAmount: o.totalAmount,
            status: o.status,
            createdAt: o.createdAt,
            storeId: o.storeId,
            orderType: 'store',
          },
          ['createdAt'],
        );
      }
      const r = item.o;
      return enrichWithJordanTime(
        {
          id: r.id,
          totalAmount: Number(r.amount) || 0,
          status: r.status,
          createdAt: r.createdAt,
          storeId: null,
          orderType: 'arheb_box',
        },
        ['createdAt'],
      );
    });

    const data = {
      totalOrders: orders.length + boxRows.length,
      totalRevenue,
      byStatus,
      recentOrders: recent,
      dateRange: range,
    };
    // Admin and SuperAdmin only: open/closed/paused store counts. Jordan time + opening hours: open = within hours + admin open + unpaused; closed = admin closed or outside hours (not paused); paused = separate count.
    if (req.admin.role === ROLES.ADMIN || req.admin.role === ROLES.SUPERADMIN) {
      const stores = loadStores();
      data.pausedStoresCount = stores.filter((s) => s.paused === true).length;
      const notPausedOrBlocked = (s) => s.paused !== true && s.blocked !== true;
      data.openStoresCount = stores.filter((s) => notPausedOrBlocked(s) && s.isOpen !== false && isWithinOpeningHours(s)).length;
      data.closedStoresCount = stores.filter((s) => notPausedOrBlocked(s) && (s.isOpen === false || !isWithinOpeningHours(s))).length;
    }
    return res.status(200).json({ success: true, data });
  });

  // ——— Arheb Box requests (admin can list, update status, assign driver) ———
  app.get('/api/admin/arheb-box', auth, (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM arheb_box_requests ORDER BY createdAt DESC, id DESC').all();
      const requests = rows.map((r) => enrichArhebBoxRow(r, db));
      return res.status(200).json({ success: true, data: { requests } });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { requests: [] } });
      }
      console.error('Arheb box list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list arheb box requests' });
    }
  });

  app.get('/api/admin/arheb-box/:id', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    try {
      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      return res.status(200).json({
        success: true,
        data: { request: enrichArhebBoxRow(row, db) },
      });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      }
      console.error('Arheb box get error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load request' });
    }
  });

  // ——— Delete Arheb Box request permanently (SuperAdmin only) ———
  app.delete('/api/admin/arheb-box/:id', auth, (req, res) => {
    if (req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Only SuperAdmin can delete Arheb Box requests' });
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    try {
      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      try {
        db.prepare('DELETE FROM driver_requests WHERE orderId = ?').run(id);
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }
      try {
        db.prepare('DELETE FROM payment_transactions WHERE arhebBoxRequestId = ?').run(id);
      } catch (e) { /* ignore */ }
      db.prepare('DELETE FROM arheb_box_requests WHERE id = ?').run(id);
      logActivity(db, req, {
        action: 'delete',
        resourceType: 'arheb_box',
        resourceId: String(id),
        storeScopeId: null,
        summary: `Arheb Box #${id} deleted permanently`,
      });
      return res.status(200).json({ success: true, message: `Arheb Box request #${id} deleted permanently` });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      }
      console.error('Arheb box delete error:', e);
      return res.status(500).json({ success: false, message: 'Failed to delete request' });
    }
  });

  app.patch('/api/admin/arheb-box/:id', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const { status } = req.body || {};
    if (status === undefined || typeof status !== 'string' || !status.trim()) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    try {
      const rowBefore = db.prepare('SELECT id, phoneNumber, fcmToken FROM arheb_box_requests WHERE id = ?').get(id);
      if (!rowBefore) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      const nextStatus = status.trim();
      const run = db.prepare('UPDATE arheb_box_requests SET status = ? WHERE id = ?').run(nextStatus, id);
      if (run.changes === 0) {
        return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      }
      try {
        const { emitArhebBoxEvent } = require('../order');
        if (emitArhebBoxEvent) emitArhebBoxEvent(id, 'status_update', { status: nextStatus });
      } catch (e) { /* ignore */ }
      fcm
        .sendToToken(
          rowBefore.fcmToken,
          'Arheb Box update',
          `Your request #${id} is now: ${nextStatus}`,
          null,
          { type: 'arheb_box_status', requestId: String(id), status: nextStatus },
          { db },
        )
        .catch(() => {});
      if (!rowBefore.fcmToken) {
        fcm.sendToUserByPhone(db, rowBefore.phoneNumber, 'Arheb Box update', `Your request #${id} is now: ${nextStatus}`, null, { type: 'arheb_box_status', requestId: String(id), status: nextStatus }).catch(() => {});
      }
      if (String(nextStatus).toLowerCase() === 'delivered') {
        if (isEinvoicePaused(db)) {
          try {
            db.prepare(`UPDATE arheb_box_requests SET einvoiceStatus = 'paused', einvoiceError = ? WHERE id = ?`).run(
              'E-invoice submissions are paused',
              id,
            );
          } catch (e) { /* ignore */ }
        } else {
          try {
            const { submitJofotaraInvoiceForArhebBox } = require('../jofotara');
            submitJofotaraInvoiceForArhebBox(db, id).catch((err) => {
              console.error(`[jofotara] Async submission failed for arheb box ${id}:`, err?.message || err);
            });
          } catch (e) { /* ignore */ }
        }
      }
      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      const request = enrichArhebBoxRow(row, db);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'arheb_box',
        resourceId: String(id),
        storeScopeId: null,
        summary: `Arheb Box #${id} status → ${nextStatus}`,
      });
      return res.status(200).json({ success: true, data: { request } });
    } catch (e) {
      console.error('Arheb box update error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update' });
    }
  });

  app.post('/api/admin/arheb-box/:id/assign-driver', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const { driverId } = req.body || {};
    const driverIdNum = driverId != null ? parseInt(driverId, 10) : NaN;
    if (!driverIdNum || isNaN(driverIdNum)) return res.status(400).json({ success: false, message: 'driverId is required' });
    try {
      const row = db.prepare('SELECT id FROM arheb_box_requests WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      const driver = db.prepare('SELECT id, name FROM drivers WHERE id = ? AND isBlocked = 0').get(driverIdNum);
      if (!driver) return res.status(404).json({ success: false, message: 'Driver not found or blocked' });
      db.prepare('UPDATE arheb_box_requests SET driverId = ?, driverName = ?, status = ? WHERE id = ?').run(driverIdNum, driver.name, 'assigned', id);
      clearArhebBoxOfferExpansion(id);
      try {
        writeArhebBoxDriverEarningsSnapshot(db, id, driverIdNum);
      } catch (e) {
        /* ignore */
      }
      try { const { emitArhebBoxEvent } = require('../order'); if (emitArhebBoxEvent) emitArhebBoxEvent(id, 'status_update', { status: 'assigned' }); } catch (e) { /* ignore */ }
      const updated = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      const driverFcmData = {
        ...fcmPayloadForArhebBoxRequest(updated, id),
        status: 'assigned',
      };
      fcm
        .sendToDriver(
          db,
          driverIdNum,
          'New delivery assigned',
          `Arheb Box #${id} has been assigned to you. Open the app for details.`,
          driverFcmData,
        )
        .catch((err) => console.warn('[arheb-box] assign-driver FCM:', err?.message || err));
      const custAssigned = customerArhebBoxTrackingData(id, 'assigned');
      const custTitle = 'Driver assigned';
      const custBody = `A driver has been assigned to your Arheb Box request #${id}.`;
      if (updated.fcmToken && String(updated.fcmToken).trim()) {
        fcm.sendToToken(updated.fcmToken, custTitle, custBody, null, custAssigned, { db }).catch(() => {});
      } else {
        fcm.sendToUserByPhone(db, updated.phoneNumber, custTitle, custBody, null, custAssigned).catch(() => {});
      }
      try {
        const { emitDriverDeliveryRequest } = require('../driverPresence');
        if (io) {
          emitDriverDeliveryRequest(io, driverIdNum, {
            orderId: id,
            requestId: id,
            status: 'assigned',
            storeName: 'Arheb Box',
            type: 'driver_assigned',
            orderType: 'arheb_box',
          });
        }
      } catch (_) { /* ignore */ }
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'arheb_box',
        resourceId: String(id),
        storeScopeId: null,
        summary: `Arheb Box #${id}: assigned driver ${driverIdNum}`,
        details: { driverName: driver.name },
      });
      return res.status(200).json({
        success: true,
        message: 'Driver assigned. They will be notified.',
        data: {
          request: enrichArhebBoxRow(updated, db),
        },
      });
    } catch (e) {
      console.error('Arheb box assign driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to assign driver' });
    }
  });

  app.post('/api/admin/arheb-box/:id/reassign-driver', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const { driverId } = req.body || {};
    const driverIdNum = driverId != null ? parseInt(driverId, 10) : NaN;
    if (!driverIdNum || isNaN(driverIdNum)) return res.status(400).json({ success: false, message: 'driverId is required' });
    try {
      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      const st = String(row.status || '').trim().toLowerCase();
      if (st === 'delivered' || st === 'cancelled') {
        return res.status(400).json({ success: false, message: 'Cannot reassign a completed or cancelled request' });
      }
      if (row.driverId == null) {
        return res.status(400).json({
          success: false,
          message: 'No driver is assigned yet. Use assign-driver first.',
        });
      }
      if (Number(row.driverId) === driverIdNum) {
        const updatedSame = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
        return res.status(200).json({
          success: true,
          message: 'Already assigned to this driver',
          data: { request: enrichArhebBoxRow(updatedSame, db) },
        });
      }
      const oldDriverId = Number(row.driverId);
      const driver = db.prepare('SELECT id, name FROM drivers WHERE id = ? AND isBlocked = 0').get(driverIdNum);
      if (!driver) return res.status(404).json({ success: false, message: 'Driver not found or blocked' });
      db.prepare('UPDATE arheb_box_requests SET driverId = ?, driverName = ? WHERE id = ?').run(driverIdNum, driver.name, id);
      clearArhebBoxOfferExpansion(id);
      try {
        writeArhebBoxDriverEarningsSnapshot(db, id, driverIdNum);
      } catch (e) {
        /* ignore */
      }
      try {
        const { emitArhebBoxEvent } = require('../order');
        if (emitArhebBoxEvent) emitArhebBoxEvent(id, 'status_update', { status: row.status });
      } catch (e) {
        /* ignore */
      }
      const updated = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      fcm
        .sendToDriver(
          db,
          driverIdNum,
          'Arheb Box reassigned',
          `Arheb Box #${id} has been assigned to you.`,
          { ...fcmPayloadForArhebBoxRequest(updated, id), orderType: 'arheb_box' },
        )
        .catch((err) => console.warn('[arheb-box] reassign FCM:', err?.message || err));
      if (oldDriverId && oldDriverId !== driverIdNum) {
        fcm
          .sendToDriver(db, oldDriverId, 'Arheb Box reassigned', `Arheb Box #${id} was assigned to another driver.`, {
            type: 'arheb_box_request_rejected',
            requestId: String(id),
            driverId: String(oldDriverId),
          })
          .catch(() => {});
      }
      const cust = customerArhebBoxTrackingData(id, row.status || '');
      fcm
        .sendToToken(
          updated.fcmToken,
          'Driver update',
          `A new driver is handling your Arheb Box request #${id}.`,
          null,
          cust,
          { db },
        )
        .catch(() => {});
      if (!updated.fcmToken) {
        fcm.sendToUserByPhone(db, updated.phoneNumber, 'Driver update', `A new driver is handling your Arheb Box request #${id}.`, null, cust).catch(() => {});
      }
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'arheb_box',
        resourceId: String(id),
        storeScopeId: null,
        summary: `Arheb Box #${id}: reassigned driver → ${driverIdNum}`,
        details: { previousDriverId: oldDriverId },
      });
      try {
        const { broadcastDriverOrdersUpdated, emitDriverDeliveryRequest } = require('../driverPresence');
        if (oldDriverId && oldDriverId !== driverIdNum) {
          broadcastDriverOrdersUpdated(io, { type: 'arheb_box_request_rejected', requestId: id, driverId: oldDriverId });
        }
        broadcastDriverOrdersUpdated(io, { type: 'arheb_box_accepted', requestId: id, driverId: driverIdNum });
        if (io) {
          emitDriverDeliveryRequest(io, driverIdNum, {
            orderId: id,
            requestId: id,
            status: String(updated.status || row.status || 'assigned'),
            storeName: 'Arheb Box',
            type: 'driver_assigned',
            orderType: 'arheb_box',
          });
        }
      } catch (e) {
        /* ignore */
      }
      return res.status(200).json({
        success: true,
        message: 'Driver reassigned.',
        data: { request: enrichArhebBoxRow(updated, db) },
      });
    } catch (e) {
      console.error('Arheb box reassign driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to reassign driver' });
    }
  });

  // ——— Arheb Box: nearest driver only (sequential + 20s timeout). Admin / SuperAdmin only ———
  app.post('/api/admin/arheb-box/:id/request-driver', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    try {
      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });

      if (row.status === 'pending' || row.status === 'pending_payment') {
        db.prepare("UPDATE arheb_box_requests SET status = 'confirmed' WHERE id = ?").run(id);
        try {
          const { emitArhebBoxEvent } = require('../order');
          if (emitArhebBoxEvent) emitArhebBoxEvent(id, 'status_update', { status: 'confirmed' });
        } catch (e) {
          /* ignore */
        }
      }
      const updatedRow = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      if (String(updatedRow?.status || '').toLowerCase() === 'confirmed') {
        fcm
          .sendToToken(
            updatedRow.fcmToken,
            'Arheb Box update',
            `Your request #${id} is now: confirmed`,
            null,
            { type: 'arheb_box_status', requestId: String(id), status: 'confirmed' },
            { db },
          )
          .catch(() => {});
        if (!updatedRow.fcmToken) {
          fcm
            .sendToUserByPhone(
              db,
              updatedRow.phoneNumber,
              'Arheb Box update',
              `Your request #${id} is now: confirmed`,
              null,
              { type: 'arheb_box_status', requestId: String(id), status: 'confirmed' },
            )
            .catch(() => {});
        }
      }

      if (updatedRow.driverId != null) {
        return res.status(400).json({ success: false, message: 'Request already has a driver assigned' });
      }

      const pendingBox =
        db.prepare('SELECT COUNT(*) AS n FROM driver_requests WHERE orderId = ? AND status = ?').get(-id, 'pending')?.n ?? 0;
      if (pendingBox > 0) {
        return res.status(400).json({
          success: false,
          message: 'A driver request is already pending for this Arheb Box. Wait for accept/reject or assign manually.',
        });
      }

      clearArhebBoxOfferExpansion(id);
      const next = offerNextSequentialArhebBoxDriver(db, io, id, updatedRow, { getActiveFromListWithDistance });
      const notifiedIds = next ? [next.driverId] : [];

      if (io) io.emit('orders_updated', { source: 'arheb_box_request_driver', requestId: id });

      logActivity(db, req, {
        action: 'edit',
        resourceType: 'arheb_box',
        resourceId: String(id),
        storeScopeId: null,
        summary: `Arheb Box #${id}: requested driver (sequential nearest${next ? ` → ${next.driverId}` : ''})`,
      });

      if (!next) {
        return res.status(400).json({
          success: false,
          message:
            'No driver could be notified. Drivers should open the app and connect near pickup, or assign manually.',
          data: { notifiedDriverIds: [], request: enrichArhebBoxRow(updatedRow, db) },
        });
      }

      try {
        const { broadcastDriverOrdersUpdated } = require('../driverPresence');
        broadcastDriverOrdersUpdated(io, { type: 'arheb_box_new_request', requestId: id });
      } catch (e) {
        /* ignore */
      }

      return res.status(200).json({
        success: true,
        message: `Request sent to nearest available driver (#${next.driverId}). Next driver is tried if they do not accept within 20 seconds.`,
        data: { notifiedDriverIds: notifiedIds, request: enrichArhebBoxRow(updatedRow, db), driverId: next.driverId },
      });
    } catch (e) {
      console.error('Arheb box request-driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to request driver' });
    }
  });

  app.get('/api/admin/settings/driver-commission', auth, requireAdminOrSuper, (req, res) => {
    try {
      ensureDriverCommissionSettingsTable(db);
      const s = getDriverCommissionSettings(db);
      return res.status(200).json({
        success: true,
        data: {
          commissionType: s.type,
          commissionValue: s.value,
          note:
            'Fallback when App info driverDeliveryPercent (GET/PATCH /api/admin/info) is unset. Prefer setting the default under App info; per-driver overrides use drivers.commissionPercent.',
        },
      });
    } catch (e) {
      console.error('Get driver commission settings error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load settings' });
    }
  });

  app.patch('/api/admin/settings/driver-commission', auth, requireAdminOrSuper, (req, res) => {
    const { commissionType, commissionValue } = req.body || {};
    if (commissionType === undefined && commissionValue === undefined) {
      return res.status(400).json({ success: false, message: 'commissionType and/or commissionValue required' });
    }
    try {
      ensureDriverCommissionSettingsTable(db);
      const cur = getDriverCommissionSettings(db);
      let nextType = cur.type;
      if (commissionType !== undefined && commissionType !== null && String(commissionType).trim() !== '') {
        const t = String(commissionType).toLowerCase();
        nextType = t === 'fixed' ? 'fixed' : 'percent';
      }
      const nextVal = commissionValue !== undefined ? commissionValue : cur.value;
      const updated = setDriverCommissionSettings(db, nextType, nextVal);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'driver_commission_settings',
        resourceId: null,
        storeScopeId: null,
        summary: `Driver commission settings: ${updated.type} = ${updated.value}`,
      });
      return res.status(200).json({
        success: true,
        message: 'Driver commission updated',
        data: {
          commissionType: updated.type,
          commissionValue: updated.value,
          note:
            'Legacy fallback when App info driverDeliveryPercent is not set. Prefer GET/PATCH /api/admin/info for the app-wide default driver delivery percent.',
        },
      });
    } catch (e) {
      if (e.code === 'VALIDATION') {
        return res.status(400).json({ success: false, message: e.message });
      }
      console.error('Patch driver commission error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
  });

  // ——— Drivers (SuperAdmin / Admin only: add, remove, block) ———
  app.get('/api/admin/drivers/export', auth, requireAdminOrSuper, (req, res) => {
    try {
      ensureDriverRatingsTable(db);
      ensureDriverCommissionPercentColumn(db);
      ensureContactUsDriverDeliveryPercentColumn(db);
      const defaultPct = getDriverDeliveryDefaultPercent(db);
      const rows = db
        .prepare(
          'SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, rating, ratingCount, isVerified, isBlocked, createdAt, commissionPercent FROM drivers ORDER BY id',
        )
        .all();
      const exportRows = rows.map((r) =>
        enrichWithJordanTime(
          {
            id: r.id,
            name: r.name,
            mobile: r.mobile,
            email: r.email ?? '',
            vehicleType: r.vehicleType ?? '',
            vehicleNumber: r.vehicleNumber ?? '',
            licenseNumber: r.licenseNumber ?? '',
            rating: r.rating ?? 5,
            ratingCount: r.ratingCount != null ? Number(r.ratingCount) : 0,
            isVerified: Boolean(r.isVerified),
            isBlocked: Boolean(r.isBlocked),
            commissionPercent: normalizeDriverCommissionPercent(r.commissionPercent, defaultPct),
            createdAt: r.createdAt,
          },
          ['createdAt'],
        ),
      );

      const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).slice(0, 10) : '';
      const dateTo = req.query.dateTo ? String(req.query.dateTo).slice(0, 10) : '';
      const paymentTypeQ = req.query.paymentType ? String(req.query.paymentType).trim() : '';
      const storeIdQ = req.query.storeId ? String(req.query.storeId).trim() : '';
      const driverIdQ = req.query.driverId ? String(req.query.driverId).trim() : '';
      const oCond = ['driverId IS NOT NULL'];
      const oParams = [];
      if (dateFrom) {
        oCond.push('date(createdAt) >= date(?)');
        oParams.push(dateFrom);
      }
      if (dateTo) {
        oCond.push('date(createdAt) <= date(?)');
        oParams.push(dateTo);
      }
      if (paymentTypeQ) {
        oCond.push("LOWER(TRIM(COALESCE(paymentType, ''))) = LOWER(?)");
        oParams.push(paymentTypeQ);
      }
      if (storeIdQ) {
        oCond.push('CAST(storeId AS TEXT) = ?');
        oParams.push(storeIdQ);
      }
      if (driverIdQ) {
        const did = parseInt(driverIdQ, 10);
        if (!isNaN(did)) {
          oCond.push('driverId = ?');
          oParams.push(did);
        }
      }
      let assignOrders = [];
      try {
        assignOrders = db
          .prepare(`SELECT * FROM orders WHERE ${oCond.join(' AND ')} ORDER BY createdAt DESC LIMIT 5000`)
          .all(...oParams);
      } catch (e) {
        assignOrders = [];
      }
      const storesList = loadStores();
      const storeById = Object.fromEntries(storesList.map((s) => [String(s.id), s]));
      const assignRows = assignOrders.map((o) => {
        const st = o.storeId ? storeById[String(o.storeId)] : null;
        return {
          orderId: o.id,
          driverId: o.driverId,
          driverName: o.driverName || '',
          storeId: o.storeId || '',
          storeName: st ? (st.nameEn || st.name || st.nameAr) : '',
          customerName: o.name || '',
          phoneNumber: o.phoneNumber || '',
          orderSubtotalJod: o.totalAmount,
          deliveryFeeJod: o.deliveryFee,
          serviceFeeJod: o.serviceFee,
          driverEarningsJod: o.driverEarnings,
          paymentType: o.paymentType,
          status: o.status,
          createdAt: o.createdAt,
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(wb, ws, 'Drivers');
      const wsA = XLSX.utils.json_to_sheet(assignRows.length ? assignRows : [{ message: 'No assignment rows for filters' }]);
      XLSX.utils.book_append_sheet(wb, wsA, 'Assignments');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="drivers-export.xlsx"');
      return res.send(buf);
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet([]);
        XLSX.utils.book_append_sheet(wb, ws, 'Drivers');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="drivers-export.xlsx"');
        return res.send(buf);
      }
      console.error('Drivers export error:', e);
      return res.status(500).json({ success: false, message: 'Export failed' });
    }
  });

  app.get('/api/admin/drivers', auth, requireAdminOrSuper, (req, res) => {
    try {
      ensureDriverRatingsTable(db);
      ensureDriverCommissionPercentColumn(db);
      ensureContactUsDriverDeliveryPercentColumn(db);
      const defaultPct = getDriverDeliveryDefaultPercent(db);
      const rows = db.prepare(
        'SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, photo, latitude, longitude, rating, ratingCount, isVerified, isBlocked, createdAt, commissionPercent FROM drivers ORDER BY id'
      ).all();
      const drivers = rows.map((r) => ({
        id: r.id,
        name: r.name,
        mobile: r.mobile,
        email: r.email,
        vehicleType: r.vehicleType,
        vehicleNumber: r.vehicleNumber,
        licenseNumber: r.licenseNumber,
        photo: r.photo,
        latitude: r.latitude,
        longitude: r.longitude,
        rating: r.rating ?? 5,
        ratingCount: r.ratingCount != null ? Number(r.ratingCount) : 0,
        isVerified: Boolean(r.isVerified),
        isBlocked: Boolean(r.isBlocked),
        commissionPercent: normalizeDriverCommissionPercent(r.commissionPercent, defaultPct),
        createdAt: r.createdAt,
      }));
      return res.status(200).json({ success: true, data: { drivers } });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { drivers: [] } });
      }
      console.error('Admin drivers list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list drivers' });
    }
  });

  // Driver profile: orders (filterable), earnings totals, customer ratings (admin sees all)
  app.get('/api/admin/drivers/:id/profile', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid driver id' });
    try {
      ensureOrderDriverShareColumns(db);
      ensureDriverRatingsTable(db);
      ensureDriverCommissionPercentColumn(db);
      const driver = db
        .prepare(
          'SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked, createdAt, rating, ratingCount, commissionPercent FROM drivers WHERE id = ?'
        )
        .get(id);
      if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

      const statusFilter = req.query.status ? String(req.query.status).trim() : '';
      const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).slice(0, 10) : '';
      const dateTo = req.query.dateTo ? String(req.query.dateTo).slice(0, 10) : '';
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage, 10) || 25));

      const counts = db
        .prepare(`
          SELECT
            SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN status IS NULL OR status NOT IN ('Delivered', 'Cancelled') THEN 1 ELSE 0 END) AS active
          FROM orders
          WHERE driverId = ?
        `)
        .get(id) || {};

      let orderRows = db.prepare('SELECT * FROM orders WHERE driverId = ? ORDER BY createdAt DESC, id DESC').all(id);
      if (statusFilter && statusFilter.toLowerCase() !== 'all') {
        orderRows = orderRows.filter((o) => String(o.status || '') === statusFilter);
      }
      if (dateFrom) {
        orderRows = orderRows.filter((o) => String(o.createdAt || '').slice(0, 10) >= dateFrom);
      }
      if (dateTo) {
        orderRows = orderRows.filter((o) => String(o.createdAt || '').slice(0, 10) <= dateTo);
      }

      const deliveredFiltered = orderRows.filter((o) => String(o.status || '') === 'Delivered');
      let totalProfit = 0;
      let totalDeliveryFees = 0;
      for (const o of deliveredFiltered) {
        const share = resolveOrderDriverShare(db, o);
        totalProfit += share.earningsJod;
        totalDeliveryFees += Number(o.deliveryFee) || 0;
      }
      let arhebBoxDelivered = [];
      try {
        arhebBoxDelivered = db
          .prepare(`SELECT * FROM arheb_box_requests WHERE driverId = ? AND LOWER(TRIM(status)) = 'delivered'`)
          .all(id);
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }
      if (dateFrom) {
        arhebBoxDelivered = arhebBoxDelivered.filter((b) => String(b.createdAt || '').slice(0, 10) >= dateFrom);
      }
      if (dateTo) {
        arhebBoxDelivered = arhebBoxDelivered.filter((b) => String(b.createdAt || '').slice(0, 10) <= dateTo);
      }
      for (const b of arhebBoxDelivered) {
        const share = resolveArhebBoxDriverShare(db, b);
        totalProfit += share.earningsJod;
        totalDeliveryFees += Number(b.deliveryFee) || 0;
      }

      const totalOrders = orderRows.length;
      const offset = (page - 1) * perPage;
      const slice = orderRows.slice(offset, offset + perPage);
      const ordersPayload = slice.map((o) => {
        const share = resolveOrderDriverShare(db, o);
        return {
          id: o.id,
          status: o.status,
          totalAmount: o.totalAmount,
          deliveryFee: o.deliveryFee,
          createdAt: o.createdAt,
          storeId: o.storeId,
          driverShare: {
            commissionType: share.commissionType,
            commissionValue: share.commissionValue,
            earningsJod: share.earningsJod,
          },
        };
      });

      const ratings = db
        .prepare(
          'SELECT id, orderId, userId, rating, notes, createdAt FROM driver_ratings WHERE driverId = ? ORDER BY createdAt DESC, id DESC LIMIT 200'
        )
        .all(id);

      const commission = getDriverCommissionSettings(db);
      const appDefaultPct = getDriverDeliveryDefaultPercent(db);
      const effectivePct = normalizeDriverCommissionPercent(driver.commissionPercent, appDefaultPct);

      return res.status(200).json({
        success: true,
        data: {
          driver: {
            id: driver.id,
            name: driver.name,
            mobile: driver.mobile,
            email: driver.email,
            vehicleType: driver.vehicleType,
            vehicleNumber: driver.vehicleNumber,
            licenseNumber: driver.licenseNumber,
            isBlocked: Boolean(driver.isBlocked),
            createdAt: driver.createdAt,
            rating: driver.rating ?? 5,
            ratingCount: driver.ratingCount != null ? Number(driver.ratingCount) : 0,
            commissionPercentStored: driver.commissionPercent != null ? Number(driver.commissionPercent) : null,
            commissionPercent: effectivePct,
          },
          globalCommission: {
            commissionType: commission.type,
            commissionValue: commission.value,
            note:
              'Legacy global settings. Effective default when a driver has no rate is App info driverDeliveryPercent (GET/PATCH /api/admin/info), then this value if app info is unset.',
          },
          appInfoDriverDeliveryPercent: appDefaultPct,
          stats: {
            delivered: counts.delivered || 0,
            active: counts.active || 0,
            cancelled: counts.cancelled || 0,
            totalAssigned: (counts.delivered || 0) + (counts.active || 0) + (counts.cancelled || 0),
          },
          filters: {
            status: statusFilter || 'all',
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            page,
            perPage,
            totalOrders,
          },
          earningsForFilteredDelivered: {
            orderCount: deliveredFiltered.length + arhebBoxDelivered.length,
            totalDeliveryFees: Math.round((totalDeliveryFees + Number.EPSILON) * 100) / 100,
            totalProfit: Math.round((totalProfit + Number.EPSILON) * 100) / 100,
          },
          orders: ordersPayload,
          ratings,
        },
      });
    } catch (e) {
      console.error('Admin driver profile error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load driver profile' });
    }
  });

  app.post('/api/admin/drivers', auth, requireAdminOrSuper, (req, res) => {
    const { name, mobile, email, vehicleType, vehicleNumber, licenseNumber, commissionPercent } = req.body || {};
    if (!name || !String(name).trim() || !mobile || !String(mobile).trim()) {
      return res.status(400).json({ success: false, message: 'name and mobile are required' });
    }
    const normalizedMobile = String(mobile).trim();
    try {
      ensureDriverCommissionSettingsTable(db);
      ensureDriverCommissionPercentColumn(db);
      ensureContactUsDriverDeliveryPercentColumn(db);
      let pctToStore = getDriverDeliveryDefaultPercent(db);
      if (commissionPercent !== undefined) {
        try {
          const p = parseDriverCommissionPercentForStorage(commissionPercent);
          if (p !== undefined) pctToStore = p;
        } catch (err) {
          if (err.code === 'VALIDATION') {
            return res.status(400).json({ success: false, message: err.message });
          }
          throw err;
        }
      }
      const existing = db.prepare('SELECT id FROM drivers WHERE mobile = ?').get(normalizedMobile);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Driver with this mobile already exists' });
      }
      db.prepare(`
        INSERT INTO drivers (name, mobile, email, vehicleType, vehicleNumber, licenseNumber, photo, latitude, longitude, rating, isVerified, isBlocked, commissionPercent)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 5, 0, 0, ?)
      `).run(
        String(name).trim(),
        normalizedMobile,
        email ? String(email).trim() : null,
        vehicleType ? String(vehicleType).trim() : null,
        vehicleNumber ? String(vehicleNumber).trim() : null,
        licenseNumber ? String(licenseNumber).trim() : null,
        pctToStore,
      );
      const driver = db
        .prepare('SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked, createdAt, commissionPercent FROM drivers WHERE mobile = ?')
        .get(normalizedMobile);
      logActivity(db, req, {
        action: 'add',
        resourceType: 'driver',
        resourceId: String(driver.id),
        storeScopeId: null,
        summary: `Added driver ${driver.name} (${driver.mobile})`,
      });
      return res.status(201).json({
        success: true,
        message: 'Driver added successfully',
        data: {
          driver: {
            id: driver.id,
            name: driver.name,
            mobile: driver.mobile,
            email: driver.email,
            vehicleType: driver.vehicleType,
            vehicleNumber: driver.vehicleNumber,
            licenseNumber: driver.licenseNumber,
            isBlocked: Boolean(driver.isBlocked),
            createdAt: driver.createdAt,
            commissionPercent: normalizeDriverCommissionPercent(driver.commissionPercent, getDriverDeliveryDefaultPercent(db)),
          },
        },
      });
    } catch (e) {
      console.error('Admin add driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to add driver' });
    }
  });

  app.patch('/api/admin/drivers/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid driver id' });
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
    ensureDriverCommissionPercentColumn(db);
    ensureContactUsDriverDeliveryPercentColumn(db);
    const { name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked, commissionPercent } = req.body || {};
    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(String(name).trim()); }
    if (mobile !== undefined) { updates.push('mobile = ?'); values.push(String(mobile).trim()); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email ? String(email).trim() : null); }
    if (vehicleType !== undefined) { updates.push('vehicleType = ?'); values.push(vehicleType ? String(vehicleType).trim() : null); }
    if (vehicleNumber !== undefined) { updates.push('vehicleNumber = ?'); values.push(vehicleNumber ? String(vehicleNumber).trim() : null); }
    if (licenseNumber !== undefined) { updates.push('licenseNumber = ?'); values.push(licenseNumber ? String(licenseNumber).trim() : null); }
    if (isBlocked !== undefined) { updates.push('isBlocked = ?'); values.push(isBlocked ? 1 : 0); }
    if (commissionPercent !== undefined) {
      try {
        const p = parseDriverCommissionPercentForStorage(commissionPercent);
        updates.push('commissionPercent = ?');
        values.push(p === undefined ? null : p);
      } catch (err) {
        if (err.code === 'VALIDATION') {
          return res.status(400).json({ success: false, message: err.message });
        }
        throw err;
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }
    values.push(id);
    try {
      db.prepare(`UPDATE drivers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      const defaultPct = getDriverDeliveryDefaultPercent(db);
      const updated = db
        .prepare('SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked, createdAt, commissionPercent FROM drivers WHERE id = ?')
        .get(id);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'driver',
        resourceId: String(id),
        storeScopeId: null,
        summary: `Updated driver ${updated.name} (#${id})`,
        details: { keys: Object.keys(req.body || {}) },
      });
      return res.status(200).json({
        success: true,
        data: {
          driver: {
            id: updated.id,
            name: updated.name,
            mobile: updated.mobile,
            email: updated.email,
            vehicleType: updated.vehicleType,
            vehicleNumber: updated.vehicleNumber,
            licenseNumber: updated.licenseNumber,
            isBlocked: Boolean(updated.isBlocked),
            createdAt: updated.createdAt,
            commissionPercent: normalizeDriverCommissionPercent(updated.commissionPercent, defaultPct),
          },
        },
      });
    } catch (e) {
      console.error('Admin update driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update driver' });
    }
  });

  app.delete('/api/admin/drivers/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid driver id' });
    try {
      const driver = db.prepare('SELECT id, name, mobile FROM drivers WHERE id = ?').get(id);
      if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
      db.prepare('UPDATE orders SET driverId = NULL, driverName = NULL WHERE driverId = ?').run(id);
      db.prepare('DELETE FROM drivers WHERE id = ?').run(id);
      logActivity(db, req, {
        action: 'delete',
        resourceType: 'driver',
        resourceId: String(id),
        storeScopeId: null,
        summary: `Deleted driver ${driver.name} (#${id})`,
      });
      return res.status(200).json({ success: true, message: 'Driver removed' });
    } catch (e) {
      console.error('Admin delete driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to remove driver' });
    }
  });

  // ——— Categories (SuperAdmin / Admin only) ———
  app.get('/api/admin/categories', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    return res.status(200).json({ success: true, data: { categories } });
  });

  app.post('/api/admin/categories', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const body = req.body || {};
    const id = String(categories.length ? Math.max(...categories.map((c) => parseInt(c.id, 10) || 0)) + 1 : 1);
    const newCat = {
      id,
      name: body.name ?? (body.nameEn || '').toLowerCase().replace(/\s+/g, '_').trim() ?? '',
      nameAr: body.nameAr ?? body.name ?? '',
      nameEn: body.nameEn ?? body.name ?? '',
      image: body.image ?? null,
      iconAr: body.iconAr ?? null,
      iconEn: body.iconEn ?? null,
      isComingSoon: Boolean(body.isComingSoon),
      order: body.order ?? categories.length + 1,
      subCategories: Array.isArray(body.subCategories) ? body.subCategories : [],
    };
    categories.push(newCat);
    try {
    syncCategoriesToDb(db, categories);
    } catch (err) {
      console.error('Categories DB sync failed:', err);
      categories.pop();
      return res.status(500).json({ success: false, message: 'Database sync failed', error: err.message });
    }
    saveCategories(categories);
    logActivity(db, req, {
      action: 'add',
      resourceType: 'category',
      resourceId: String(newCat.id),
      storeScopeId: null,
      summary: `Added category ${newCat.nameEn || newCat.name || newCat.id}`,
    });
    return res.status(201).json({ success: true, data: { category: newCat } });
  });

  app.patch('/api/admin/categories/:id', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const idParam = String(req.params.id);
    const idx = categories.findIndex((c) => String(c.id) === idParam);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Category not found' });
    const allowed = ['name', 'nameAr', 'nameEn', 'image', 'iconAr', 'iconEn', 'isComingSoon', 'order', 'subCategories'];
    const body = req.body || {};
    for (const key of allowed) {
      if (body[key] !== undefined) categories[idx][key] = body[key];
    }
    // Keep name in sync when only nameEn/nameAr sent (e.g. from dashboard)
    if (body.nameEn !== undefined && body.name === undefined && categories[idx].nameEn) {
      categories[idx].name = (categories[idx].nameEn || '').toLowerCase().replace(/\s+/g, '_').trim() || categories[idx].name;
    }
    try {
    syncCategoriesToDb(db, categories);
    } catch (err) {
      console.error('Categories DB sync failed:', err);
      return res.status(500).json({ success: false, message: 'Database sync failed', error: err.message });
    }
    saveCategories(categories);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'category',
      resourceId: idParam,
      storeScopeId: null,
      summary: `Updated category ${idParam}`,
      details: { keys: Object.keys(body) },
    });
    return res.status(200).json({ success: true, data: { category: categories[idx] } });
  });

  app.delete('/api/admin/categories/:id', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const idParam = String(req.params.id);
    const idx = categories.findIndex((c) => String(c.id) === idParam);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Category not found' });
    categories.splice(idx, 1);
    try {
    syncCategoriesToDb(db, categories);
    } catch (err) {
      console.error('Categories DB sync failed:', err);
      return res.status(500).json({ success: false, message: 'Database sync failed', error: err.message });
    }
    saveCategories(categories);
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'category',
      resourceId: idParam,
      storeScopeId: null,
      summary: `Deleted category ${idParam}`,
    });
    return res.status(200).json({ success: true, message: 'Category deleted' });
  });

  // ——— Popup (SuperAdmin / Admin only) ———
  app.get('/api/admin/popup', auth, requireAdminOrSuper, (req, res) => {
    const data = loadPopup();
    return res.status(200).json({ success: true, data: { popup: data } });
  });

  app.patch('/api/admin/popup', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const current = loadPopup();
    const updated = {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : current.enabled !== false,
      image: body.image !== undefined ? body.image : current.image,
      call_of_action_button: body.call_of_action_button !== undefined ? body.call_of_action_button : current.call_of_action_button,
      destination: body.destination !== undefined ? body.destination : current.destination,
      destination_value: body.destination_value !== undefined ? body.destination_value : current.destination_value,
    };
    savePopup(updated);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'popup',
      resourceId: null,
      storeScopeId: null,
      summary: 'Updated app popup',
    });
    return res.status(200).json({ success: true, data: { popup: updated } });
  });

  app.delete('/api/admin/popup', auth, requireAdminOrSuper, (req, res) => {
    const cleared = {
      enabled: false,
      image: '',
      call_of_action_button: '',
      destination: '',
      destination_value: '',
    };
    savePopup(cleared);
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'popup',
      resourceId: null,
      storeScopeId: null,
      summary: 'Removed / reset app popup',
    });
    return res.status(200).json({ success: true, message: 'Popup removed', data: { popup: cleared } });
  });

  // ——— Home banners / offers: link picker data (names → ids in dashboard) ———
  app.get('/api/admin/home/link-options', auth, requireAdminOrSuper, (req, res) => {
    try {
      const stores = sortStoresOpenFirst(loadStores()).map((s) => ({
        id: String(s.id),
        name: s.name ?? '',
        nameAr: s.nameAr ?? '',
        nameEn: s.nameEn ?? '',
      }));
      const categories = loadCategories().map((c) => ({
        id: String(c.id),
        name: c.name ?? '',
        nameAr: c.nameAr ?? '',
        nameEn: c.nameEn ?? '',
      }));
      const products = loadProducts()
        .filter((p) => p.id != null && String(p.id).trim() !== '')
        .map((p) => ({
          id: String(p.id),
          name: p.name ?? '',
          nameAr: p.nameAr ?? '',
          nameEn: p.nameEn ?? '',
          storeId: p.store?.id != null ? String(p.store.id) : '',
        }))
        .sort((a, b) =>
          String(a.nameEn || a.name || '').localeCompare(String(b.nameEn || b.name || ''), undefined, {
            sensitivity: 'base',
          }),
        );
      return res.status(200).json({
        success: true,
        data: { stores, categories, products },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: 'Failed to load link options' });
    }
  });

  // ——— Home banners (SuperAdmin / Admin only) ———
  app.get('/api/admin/home/banners', auth, requireAdminOrSuper, (req, res) => {
    const home = loadHome();
    const banners = normalizeHomeContentLinkArray(home?.data?.banners ?? []);
    return res.status(200).json({ success: true, data: { banners } });
  });

  app.patch('/api/admin/home/banners', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const home = loadHome();
    const data = home.data || {};
    const banners = normalizeHomeContentLinkArray(
      Array.isArray(body.banners) ? body.banners : data.banners || [],
    );
    const next = {
      ...home,
      data: {
        ...data,
        banners,
      },
    };
    saveHome(next);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'home_banner',
      resourceId: null,
      storeScopeId: null,
      summary: `Updated home banners (${banners.length} item(s))`,
    });
    return res.status(200).json({ success: true, data: { banners } });
  });

  // ——— Home top offers (SuperAdmin / Admin only) — same backing file as GET /api/home `data.offers` ———
  app.get('/api/admin/home/offers', auth, requireAdminOrSuper, (req, res) => {
    const home = loadHome();
    const offers = normalizeHomeContentLinkArray(home?.data?.offers ?? []);
    return res.status(200).json({ success: true, data: { offers } });
  });

  app.patch('/api/admin/home/offers', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const home = loadHome();
    const data = home.data || {};
    const offers = normalizeHomeContentLinkArray(
      Array.isArray(body.offers) ? body.offers : data.offers || [],
    );
    const next = {
      ...home,
      data: {
        ...data,
        offers,
      },
    };
    saveHome(next);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'home_offer',
      resourceId: null,
      storeScopeId: null,
      summary: `Updated home offers (${offers.length} item(s))`,
    });
    return res.status(200).json({ success: true, data: { offers } });
  });

  // ——— App info / Contact (email, phone, cliqNumber) — Admin & SuperAdmin only ———
  app.get('/api/admin/info', auth, requireAdminOrSuper, (req, res) => {
    try {
      ensureContactUsDriverDeliveryPercentColumn(db);
      ensureContactUsArhebBoxComingSoonColumn(db);
      ensureContactUsArhebBoxServiceFeeJodColumn(db);
      ensureContactUsEinvoicePausedColumn(db);
      ensureContactUsAppVersionColumns(db);
      const appVersion = getContactAppVersions(db);
      const row = selectContactUsLatestRow(db);
      const fallbackPct = getDriverCommissionSettings(db);
      const defaultPct =
        fallbackPct.type === 'percent' ? fallbackPct.value : 0.65;
      const effectiveDefault = getDriverDeliveryDefaultPercent(db);
      const arhebBox = getArhebBoxPublicFlags(db);
      if (!row) {
        return res.status(200).json({
          success: true,
          data: {
            info: {
              email: '',
              phone: '',
              cliqNumber: '',
              driverDeliveryPercent: null,
              driverDeliveryDefaultEffective: effectiveDefault,
              arhebBoxComingSoon: false,
              arhebBoxServiceFeeJod: getArhebBoxServiceFeeJod(db),
              einvoicePaused: isEinvoicePaused(db),
              appVersion,
              arhebBox,
            },
          },
        });
      }
      const driverDeliveryPercentAppInfo =
        row.driverDeliveryPercent != null && String(row.driverDeliveryPercent).trim() !== ''
          ? normalizeDriverCommissionPercent(Number(row.driverDeliveryPercent), defaultPct)
          : null;
      const comingSoonDb = row.arhebBoxComingSoon === 1 || row.arhebBoxComingSoon === true;
      return res.status(200).json({
        success: true,
        data: {
          info: {
            email: row.email ?? '',
            phone: row.phone ?? '',
            cliqNumber: row.cliqNumber != null ? row.cliqNumber : '',
            driverDeliveryPercent: driverDeliveryPercentAppInfo,
            driverDeliveryDefaultEffective: effectiveDefault,
            arhebBoxComingSoon: comingSoonDb,
            arhebBoxServiceFeeJod: getArhebBoxServiceFeeJod(db),
            einvoicePaused:
              contactUsEinvoicePausedIsTruthy(row.einvoicePaused) || isEinvoicePaused(db),
            appVersion,
            arhebBox,
          },
        },
      });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({
          success: true,
          data: {
            info: {
              email: '',
              phone: '',
              cliqNumber: '',
              driverDeliveryPercent: null,
              arhebBoxServiceFeeJod: 0,
              einvoicePaused: false,
              appVersion: { android: '', ios: '' },
            },
          },
        });
      }
      console.error('Admin get info error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load info' });
    }
  });

  app.patch('/api/admin/info', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const email = body.email !== undefined ? String(body.email).trim() : undefined;
    const phone = body.phone !== undefined ? String(body.phone).trim() : undefined;
    const cliqNumber = body.cliqNumber !== undefined ? String(body.cliqNumber).trim() : undefined;
    const driverDeliveryPercentRaw = body.driverDeliveryPercent;
    const comingSoonRaw = body.arhebBoxComingSoon;
    let comingSoonToStore = null;
    if (comingSoonRaw !== undefined) {
      comingSoonToStore = comingSoonRaw === true || comingSoonRaw === 1 || comingSoonRaw === '1' || String(comingSoonRaw).toLowerCase() === 'true' ? 1 : 0;
    }
    const arhebBoxFeeRaw = body.arhebBoxServiceFeeJod;
    let serviceFeeToStore = undefined;
    if (arhebBoxFeeRaw !== undefined) {
      if (req.admin.role !== ROLES.SUPERADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin can update Arheb Box service fee' });
      }
      const v = Number(arhebBoxFeeRaw);
      if (!Number.isFinite(v) || v < 0) {
        return res.status(400).json({ success: false, message: 'arhebBoxServiceFeeJod must be a non-negative number' });
      }
      serviceFeeToStore = Math.round((v + Number.EPSILON) * 100) / 100;
    }
    const einvoicePausedRaw = body.einvoicePaused;
    let einvoicePausedToStore = null;
    if (einvoicePausedRaw !== undefined) {
      einvoicePausedToStore =
        einvoicePausedRaw === true || einvoicePausedRaw === 1 || einvoicePausedRaw === '1' || String(einvoicePausedRaw).toLowerCase() === 'true'
          ? 1
          : 0;
    }
    let androidAppVerPatch = undefined;
    let iosAppVerPatch = undefined;
    try {
      const avBody = body.appVersion;
      if (avBody && typeof avBody === 'object' && !Array.isArray(avBody)) {
        if (avBody.android !== undefined) androidAppVerPatch = normalizeAdminAppVersionInput(avBody.android);
        if (avBody.ios !== undefined) iosAppVerPatch = normalizeAdminAppVersionInput(avBody.ios);
      }
      if (body.appVersionAndroid !== undefined) {
        androidAppVerPatch = normalizeAdminAppVersionInput(body.appVersionAndroid);
      }
      if (body.appVersionIos !== undefined) {
        iosAppVerPatch = normalizeAdminAppVersionInput(body.appVersionIos);
      }
    } catch (err) {
      if (err.code === 'VALIDATION') {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    try {
      ensureContactUsDriverDeliveryPercentColumn(db);
      ensureContactUsArhebBoxComingSoonColumn(db);
      ensureContactUsArhebBoxServiceFeeJodColumn(db);
      ensureContactUsEinvoicePausedColumn(db);
      ensureContactUsAppVersionColumns(db);
      let driverPctToStore = null;
      if (driverDeliveryPercentRaw !== undefined) {
        try {
          driverPctToStore = parseDriverCommissionPercentForStorage(driverDeliveryPercentRaw);
        } catch (err) {
          if (err.code === 'VALIDATION') {
            return res.status(400).json({ success: false, message: err.message });
          }
          throw err;
        }
      }
      const latestContact = selectContactUsLatestRow(db);
      const row =
        latestContact && latestContact.id != null
          ? {
              id: latestContact.id,
              email: latestContact.email,
              phone: latestContact.phone,
              cliqNumber: latestContact.cliqNumber,
            }
          : null;
      if (!row) {
        db.prepare(
          'INSERT INTO contact_us (email, phone, cliqNumber, driverDeliveryPercent, arhebBoxComingSoon, arhebBoxServiceFeeJod, einvoicePaused, appVersionAndroid, appVersionIos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          email ?? 'contact@arheb.com',
          phone ?? '+201234567890',
          cliqNumber ?? '',
          driverPctToStore,
          comingSoonToStore != null ? comingSoonToStore : 0,
          serviceFeeToStore !== undefined ? serviceFeeToStore : 0,
          einvoicePausedToStore != null ? einvoicePausedToStore : 0,
          androidAppVerPatch !== undefined ? androidAppVerPatch : '',
          iosAppVerPatch !== undefined ? iosAppVerPatch : '',
        );
      } else {
        db.prepare(`
          UPDATE contact_us SET
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            cliqNumber = COALESCE(?, cliqNumber),
            driverDeliveryPercent = CASE WHEN ? = 1 THEN ? ELSE driverDeliveryPercent END,
            arhebBoxComingSoon = CASE WHEN ? = 1 THEN ? ELSE arhebBoxComingSoon END,
            arhebBoxServiceFeeJod = CASE WHEN ? = 1 THEN ? ELSE arhebBoxServiceFeeJod END,
            einvoicePaused = CASE WHEN ? = 1 THEN ? ELSE einvoicePaused END,
            appVersionAndroid = CASE WHEN ? = 1 THEN ? ELSE appVersionAndroid END,
            appVersionIos = CASE WHEN ? = 1 THEN ? ELSE appVersionIos END,
            updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          email ?? null,
          phone ?? null,
          cliqNumber ?? null,
          driverDeliveryPercentRaw !== undefined ? 1 : 0,
          driverPctToStore,
          comingSoonToStore !== null ? 1 : 0,
          comingSoonToStore !== null ? comingSoonToStore : 0,
          serviceFeeToStore !== undefined ? 1 : 0,
          serviceFeeToStore !== undefined ? serviceFeeToStore : null,
          einvoicePausedToStore !== null ? 1 : 0,
          einvoicePausedToStore !== null ? einvoicePausedToStore : 0,
          androidAppVerPatch !== undefined ? 1 : 0,
          androidAppVerPatch !== undefined ? androidAppVerPatch : null,
          iosAppVerPatch !== undefined ? 1 : 0,
          iosAppVerPatch !== undefined ? iosAppVerPatch : null,
          row.id,
        );
      }
      const fallbackPct = getDriverCommissionSettings(db);
      const defaultPct = fallbackPct.type === 'percent' ? fallbackPct.value : 0.65;
      const updated = selectContactUsLatestRow(db);
      const driverDeliveryPercentAppInfo =
        updated.driverDeliveryPercent != null && String(updated.driverDeliveryPercent).trim() !== ''
          ? normalizeDriverCommissionPercent(Number(updated.driverDeliveryPercent), defaultPct)
          : null;
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'app_info',
        resourceId: null,
        storeScopeId: null,
        summary: 'Updated app info / contact',
        details: { keys: Object.keys(body) },
      });
      const comingSoonDb = updated.arhebBoxComingSoon === 1 || updated.arhebBoxComingSoon === true;
      const appVersion = getContactAppVersions(db);
      return res.status(200).json({
        success: true,
        data: {
          info: {
            email: updated.email ?? '',
            phone: updated.phone ?? '',
            cliqNumber: updated.cliqNumber != null ? updated.cliqNumber : '',
            driverDeliveryPercent: driverDeliveryPercentAppInfo,
            driverDeliveryDefaultEffective: getDriverDeliveryDefaultPercent(db),
            arhebBoxComingSoon: comingSoonDb,
            arhebBoxServiceFeeJod: getArhebBoxServiceFeeJod(db),
            einvoicePaused:
              contactUsEinvoicePausedIsTruthy(updated.einvoicePaused) || isEinvoicePaused(db),
            appVersion,
            arhebBox: getArhebBoxPublicFlags(db),
          },
        },
      });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(500).json({ success: false, message: 'Contact table not initialized' });
      }
      console.error('Admin patch info error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update info' });
    }
  });

  // ——— Platform store checkout fees (distance tiers + default service fee) ———
  app.get('/api/admin/settings/checkout-fees', auth, requireAdminOrSuper, (req, res) => {
    try {
      const tiers = getPlatformCheckoutFeeTiers(db);
      return res.status(200).json({
        success: true,
        data: {
          firstKmJod: tiers.firstKmJod,
          perKmJod: tiers.perKmJod,
          maxJod: tiers.maxJod,
          defaultServiceFeeJod: tiers.defaultServiceFeeJod,
          flatDeliveryFeeJod: tiers.flatDeliveryFeeJod,
          deliveryOverCartThresholdJod: tiers.deliveryOverCartThresholdJod,
          deliveryFeeAboveJod: tiers.deliveryFeeAboveJod,
          note:
            'SuperAdmin: tiers, optional flatDeliveryFeeJod (e.g. 1 = 1 JOD delivery everywhere except special-far, dashboard fixed zones, remote pins), and optional deliveryOverCartThresholdJod + deliveryFeeAboveJod (when cart total >= threshold, charge feeAbove). Per-store overrides: checkoutDeliveryFeeZero, checkoutDeliveryFeeJod, checkoutServiceFeeDisabled, checkoutServiceFeeJod, checkoutDeliveryOverCartThresholdJod, checkoutDeliveryFeeAboveJod.',
        },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: 'Failed to load checkout fee settings' });
    }
  });

  app.patch('/api/admin/settings/checkout-fees', auth, requireSuperAdmin, (req, res) => {
    try {
      const body = req.body || {};
      const patch = {
        firstKmJod: body.firstKmJod,
        perKmJod: body.perKmJod,
        maxJod: body.maxJod,
        defaultServiceFeeJod: body.defaultServiceFeeJod,
      };
      if (Object.prototype.hasOwnProperty.call(body, 'flatDeliveryFeeJod')) {
        patch.flatDeliveryFeeJod = body.flatDeliveryFeeJod;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'deliveryOverCartThresholdJod')) {
        patch.deliveryOverCartThresholdJod = body.deliveryOverCartThresholdJod;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'deliveryFeeAboveJod')) {
        patch.deliveryFeeAboveJod = body.deliveryFeeAboveJod;
      }
      const tiers = setPlatformCheckoutFeeTiers(db, patch);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'settings',
        resourceId: 'checkout-fees',
        storeScopeId: null,
        summary: 'Updated platform checkout fee tiers',
      });
      return res.status(200).json({ success: true, data: tiers });
    } catch (e) {
      if (e.code === 'VALIDATION') {
        return res.status(400).json({ success: false, message: e.message });
      }
      console.error(e);
      return res.status(500).json({ success: false, message: 'Failed to update checkout fees' });
    }
  });

  /** Fixed delivery zones (haversine km — store checkout + Arheb Box). SuperAdmin edits; Admin/SuperAdmin read. */
  app.get('/api/admin/settings/delivery-fixed-zones', auth, requireAdminOrSuper, (req, res) => {
    try {
      seedDeliveryFixedZonesIfEmpty(db);
      const zones = listDeliveryFixedZones(db);
      return res.status(200).json({
        success: true,
        data: {
          zones,
          note:
            'Circular zones around pins (WGS84 haversine distance — straight-line km, not driving distance). Default seed: جامعة العقبة للتكنولوجيا & تالا باي — 3 km, 2 JOD each.',
        },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: 'Failed to load delivery fixed zones' });
    }
  });

  app.put('/api/admin/settings/delivery-fixed-zones', auth, requireSuperAdmin, (req, res) => {
    try {
      const zones = replaceDeliveryFixedZones(db, req.body?.zones ?? []);
      logActivity(db, req, {
        action: 'edit',
        resourceType: 'settings',
        resourceId: 'delivery-fixed-zones',
        storeScopeId: null,
        summary: 'Updated dashboard fixed delivery zones',
      });
      return res.status(200).json({ success: true, data: { zones } });
    } catch (e) {
      if (e.code === 'VALIDATION') {
        return res.status(400).json({ success: false, message: e.message });
      }
      console.error(e);
      return res.status(500).json({ success: false, message: 'Failed to update delivery fixed zones' });
    }
  });

  // ——— Promo codes (SuperAdmin / Admin only) ———
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      value REAL NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec(`ALTER TABLE promo_codes ADD COLUMN storeId TEXT`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE promo_codes ADD COLUMN minOrderAmount REAL`);
  } catch (e) {
    /* exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_code_stores (
      promoCodeId INTEGER NOT NULL,
      storeId TEXT NOT NULL,
      PRIMARY KEY (promoCodeId, storeId)
    );
  `);
  const deletePromoStoresForPromo = db.prepare('DELETE FROM promo_code_stores WHERE promoCodeId = ?');
  const insertPromoStoreRow = db.prepare('INSERT INTO promo_code_stores (promoCodeId, storeId) VALUES (?, ?)');
  const selectPromoStores = db.prepare('SELECT storeId FROM promo_code_stores WHERE promoCodeId = ? ORDER BY storeId');

  function readPromoStoreIds(promoId) {
    return selectPromoStores.all(promoId).map((r) => String(r.storeId));
  }

  function writePromoStoreIds(promoId, storeIds) {
    deletePromoStoresForPromo.run(promoId);
    if (!Array.isArray(storeIds)) return;
    for (const sid of storeIds) {
      const s = String(sid ?? '').trim();
      if (s) insertPromoStoreRow.run(promoId, s);
    }
  }

  const findAllPromoCodes = db.prepare('SELECT * FROM promo_codes ORDER BY id');
  const findPromoCodeById = db.prepare('SELECT * FROM promo_codes WHERE id = ?');
  const findPromoCodeByName = db.prepare('SELECT * FROM promo_codes WHERE name = ?');

  app.get('/api/admin/promo-codes', auth, requireAdminOrSuper, (req, res) => {
    try {
      const rows = findAllPromoCodes.all().map((r) => ({
        ...r,
        storeIds: readPromoStoreIds(r.id),
      }));
      return res.status(200).json({ success: true, data: { promoCodes: rows } });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { promoCodes: [] } });
      }
      console.error('Promo codes list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list promo codes' });
    }
  });

  app.post('/api/admin/promo-codes', auth, requireAdminOrSuper, (req, res) => {
    const { name, value, storeId, storeIds, minOrderAmount } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const numValue = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      return res.status(400).json({ success: false, message: 'value must be a non-negative number' });
    }
    let minOrderAmountVal = null;
    if (minOrderAmount !== undefined && minOrderAmount !== null && String(minOrderAmount).trim() !== '') {
      const n = Number(minOrderAmount);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ success: false, message: 'minOrderAmount must be a non-negative number' });
      }
      minOrderAmountVal = n;
    }
    let storeIdVal = null;
    const multiIds = Array.isArray(storeIds) ? storeIds.map((x) => String(x).trim()).filter(Boolean) : [];
    if (multiIds.length > 0) {
      storeIdVal = null;
    } else if (storeId !== undefined && storeId !== null && String(storeId).trim() !== '') {
      storeIdVal = String(storeId).trim();
    }
    try {
      db.prepare('INSERT INTO promo_codes (name, value, storeId, minOrderAmount) VALUES (?, ?, ?, ?)').run(
        name.trim(),
        numValue,
        storeIdVal,
        minOrderAmountVal,
      );
      const created = findPromoCodeByName.get(name.trim());
      if (multiIds.length > 0) {
        db.prepare('UPDATE promo_codes SET storeId = NULL WHERE id = ?').run(created.id);
        writePromoStoreIds(created.id, multiIds);
      }
      const refreshed = findPromoCodeById.get(created.id);
      logActivity(db, req, {
        action: 'add',
        resourceType: 'promo_code',
        resourceId: String(created.id),
        storeScopeId: refreshed.storeId != null ? String(refreshed.storeId) : null,
        summary: `Added promo code ${created.name}`,
      });
      return res.status(201).json({
        success: true,
        data: {
          id: refreshed.id,
          name: refreshed.name,
          value: refreshed.value,
          storeId: refreshed.storeId != null ? refreshed.storeId : null,
          storeIds: readPromoStoreIds(refreshed.id),
          minOrderAmount: refreshed.minOrderAmount != null ? Number(refreshed.minOrderAmount) : null,
          createdAt: refreshed.createdAt,
        },
      });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(400).json({ success: false, message: 'Promo code name already exists' });
      }
      throw e;
    }
  });

  app.patch('/api/admin/promo-codes/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const target = findPromoCodeById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Promo code not found' });
    const { name, value, storeId, storeIds, minOrderAmount } = req.body || {};
    const updates = [];
    const values = [];
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'name must be a non-empty string' });
      }
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (value !== undefined) {
      const numValue = typeof value === 'number' ? value : parseFloat(value);
      if (isNaN(numValue) || numValue < 0) {
        return res.status(400).json({ success: false, message: 'value must be a non-negative number' });
      }
      updates.push('value = ?');
      values.push(numValue);
    }
    if (minOrderAmount !== undefined) {
      if (minOrderAmount === null || String(minOrderAmount).trim() === '') {
        updates.push('minOrderAmount = ?');
        values.push(null);
      } else {
        const n = Number(minOrderAmount);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ success: false, message: 'minOrderAmount must be a non-negative number or null' });
        }
        updates.push('minOrderAmount = ?');
        values.push(n);
      }
    }
    if (updates.length > 0) {
      values.push(id);
      try {
        db.prepare(`UPDATE promo_codes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      } catch (e) {
        if (e.message && e.message.includes('UNIQUE')) {
          return res.status(400).json({ success: false, message: 'Promo code name already exists' });
        }
        throw e;
      }
    }
    if (Array.isArray(storeIds)) {
      const multi = storeIds.map((x) => String(x).trim()).filter(Boolean);
      if (multi.length > 0) {
        db.prepare('UPDATE promo_codes SET storeId = NULL WHERE id = ?').run(id);
        writePromoStoreIds(id, multi);
      } else {
        writePromoStoreIds(id, []);
        db.prepare('UPDATE promo_codes SET storeId = NULL WHERE id = ?').run(id);
      }
    } else if (storeId !== undefined) {
      writePromoStoreIds(id, []);
      db.prepare('UPDATE promo_codes SET storeId = ? WHERE id = ?').run(
        storeId != null && String(storeId).trim() !== '' ? String(storeId).trim() : null,
        id,
      );
    }
    const updated = findPromoCodeById.get(id);
    logActivity(db, req, {
      action: 'edit',
      resourceType: 'promo_code',
      resourceId: String(id),
      storeScopeId: updated.storeId != null ? String(updated.storeId) : null,
      summary: `Updated promo code ${updated.name}`,
    });
    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        value: updated.value,
        storeId: updated.storeId != null ? updated.storeId : null,
        storeIds: readPromoStoreIds(updated.id),
        minOrderAmount: updated.minOrderAmount != null ? Number(updated.minOrderAmount) : null,
        createdAt: updated.createdAt,
      },
    });
  });

  app.delete('/api/admin/promo-codes/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const target = findPromoCodeById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Promo code not found' });
    try {
      deletePromoStoresForPromo.run(id);
    } catch (e) {
      /* ignore */
    }
    db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
    logActivity(db, req, {
      action: 'delete',
      resourceType: 'promo_code',
      resourceId: String(id),
      storeScopeId: target.storeId != null ? String(target.storeId) : null,
      summary: `Deleted promo code ${target.name}`,
    });
    return res.status(200).json({ success: true, message: 'Promo code deleted' });
  });

  // ——— E-Invoice (JOFOTARA) ———
  app.get('/api/admin/einvoices', auth, requireAdminOrSuper, (req, res) => {
    try {
      const { status, dateFrom, dateTo } = req.query;
      const conditions = ["einvoiceStatus IS NOT NULL AND einvoiceStatus != ''"];
      const params = [];
      if (status) {
        conditions.push('einvoiceStatus = ?');
        params.push(String(status).trim());
      }
      if (dateFrom) {
        conditions.push("date(createdAt) >= date(?)");
        params.push(String(dateFrom).trim());
      }
      if (dateTo) {
        conditions.push("date(createdAt) <= date(?)");
        params.push(String(dateTo).trim());
      }
      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const orderRows = db.prepare(
        `SELECT id, storeId, phoneNumber, name, totalAmount, deliveryFee, serviceFee, feesTax, status, paymentType,
                einvoiceStatus, einvoiceQR, einvoiceUUID, einvoiceError, einvoiceSubmittedAt, createdAt
         FROM orders${where} ORDER BY createdAt DESC LIMIT 500`,
      ).all(...params);
      let arhebBoxRows = [];
      try {
        arhebBoxRows = db.prepare(
          `SELECT id, phoneNumber, userName AS name, amount AS totalAmount, deliveryFee, serviceFee, feesTax, status, paymentMethod AS paymentType,
                  einvoiceStatus, einvoiceQR, einvoiceUUID, einvoiceError, einvoiceSubmittedAt, createdAt
           FROM arheb_box_requests${where} ORDER BY createdAt DESC LIMIT 500`,
        ).all(...params);
      } catch (e) {
        arhebBoxRows = [];
      }

      const storesList = loadStores();
      const storeMap = Object.fromEntries(storesList.map((s) => [String(s.id), s]));

      const orderEnriched = orderRows.map((o) => {
        const store = storeMap[String(o.storeId)] || null;
        return {
          orderType: 'store',
          sourceId: o.id,
          ...o,
          storeName: store ? (store.nameEn || store.name || store.nameAr || '') : '',
        };
      });
      const boxEnriched = arhebBoxRows.map((o) => ({
        orderType: 'arheb_box',
        sourceId: o.id,
        ...o,
        storeId: null,
        storeName: 'Arheb Box',
      }));
      const enriched = [...orderEnriched, ...boxEnriched].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      const counts = {
        submitted: enriched.filter((r) => r.einvoiceStatus === 'submitted').length,
        failed: enriched.filter((r) => r.einvoiceStatus === 'failed').length,
        pending: enriched.filter((r) => r.einvoiceStatus === 'pending').length,
        skipped: enriched.filter((r) => r.einvoiceStatus === 'skipped').length,
      };

      return res.status(200).json({ success: true, data: { invoices: enriched, counts } });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to load e-invoices' });
    }
  });

  app.get('/api/admin/orders/:orderId/einvoice', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.status(200).json({
      success: true,
      data: {
        orderId,
        einvoiceStatus: order.einvoiceStatus || null,
        einvoiceQR: order.einvoiceQR || null,
        einvoiceUUID: order.einvoiceUUID || null,
        einvoiceError: order.einvoiceError || null,
        einvoiceSubmittedAt: order.einvoiceSubmittedAt || null,
      },
    });
  });

  app.post('/api/admin/orders/:orderId/einvoice/retry', auth, requireAdminOrSuper, async (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const isBox =
      req.query.type === 'arheb_box' ||
      (req.body && typeof req.body === 'object' && req.body.type === 'arheb_box');

    if (isBox) {
      let row;
      try {
        row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(orderId);
      } catch (e) {
        row = null;
      }
      if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      if (row.einvoiceStatus === 'submitted') {
        return res.status(400).json({ success: false, message: 'E-invoice already submitted successfully' });
      }
      try {
        const { submitJofotaraInvoiceForArhebBox } = require('../jofotara');
        const result = await submitJofotaraInvoiceForArhebBox(db, orderId);
        return res.status(200).json({ success: result.ok, data: result });
      } catch (e) {
        return res.status(500).json({ success: false, message: e.message || 'E-invoice submission failed' });
      }
    }

    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.einvoiceStatus === 'submitted') {
      return res.status(400).json({ success: false, message: 'E-invoice already submitted successfully' });
    }
    try {
      const { submitJofotaraInvoice } = require('../jofotara');
      const result = await submitJofotaraInvoice(db, orderId);
      return res.status(200).json({ success: result.ok, data: result });
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message || 'E-invoice submission failed' });
    }
  });

  // ——— Online merchants (merchant presence) ———
  app.get('/api/admin/merchants/online', auth, requireAdminOrSuper, (req, res) => {
    try {
      const { getOnlineMerchants } = require('../merchantPresence');
      return res.status(200).json({
        success: true,
        data: { onlineMerchants: getOnlineMerchants() },
      });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to load merchant presence' });
    }
  });
};
