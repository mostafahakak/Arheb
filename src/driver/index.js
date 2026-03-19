const jwt = require('jsonwebtoken');
const fs = require('fs');
const { getJsonPath } = require('../config/jsonPaths');
const fcm = require('../fcm');
const enrichArhebBoxRow = require('../arhebBox').enrichArhebBoxRow;

function emitOrderStatus(orderId, status) {
  try {
    const { emitOrderEvent } = require('../order');
    if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status });
  } catch (e) {
    // order module may not be loaded yet
  }
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

// Map DB order + items + driver to API shape; optional store adds storeAddress, storeMapsUrl, etc.
function orderToDriverApi(order, items = [], driverRow = null, store = null) {
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
  const productList = (items || []).map((i) => ({
    id: i.productId,
    name: i.productName,
    image: null,
    price: i.price,
    quantity: i.quantity,
    unit: '',
    category: null,
    description: null,
    discount: null,
    stock: null,
    isAvailable: true,
    preparationTime: null,
    ingredients: [],
    allergens: [],
  }));
  const numberOfItems = productList.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const clientMapsUrl =
    order.addressLat != null && order.addressLong != null
      ? `https://www.google.com/maps?q=${order.addressLat},${order.addressLong}`
      : (order.addressName || address)
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.addressName || address)}`
        : null;
  const out = {
    id: String(order.id),
    orderNumber: `ORD-${String(order.id).padStart(4, '0')}`,
    products: productList,
    totalPrice: order.totalAmount ?? 0,
    deliveryFee: order.deliveryFee ?? 0,
    discountAmount: order.discount ?? 0,
    address,
    addressName: order.addressName || null,
    buildingNumber: null,
    paymentMethod: order.paymentType || 'cash',
    status: mapOrderStatus(order.status),
    orderDate: order.createdAt || null,
    notes: order.notes || null,
    customerName: order.name || null,
    customerPhone: order.phoneNumber || null,
    driverPhone: driverRow?.mobile ?? null,
    driver,
    driver_latitude: driver ? driverRow.latitude : null,
    driver_longitude: driver ? driverRow.longitude : null,
    numberOfItems,
    clientMapsUrl,
  };
  if (store) {
    out.storeName = store.nameEn || store.name || store.nameAr || null;
    out.storeAddress = store.addressEn || store.address || store.addressAr || null;
    out.storeMapsUrl = store.mapsUrl || null;
  }
  return out;
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

module.exports = function attachDriverRoutes(app, db, JWT_SECRET) {
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
    db.exec(`ALTER TABLE drivers ADD COLUMN fcmToken TEXT`);
  } catch (e) {
    // column exists
  }

  const findDriverById = db.prepare('SELECT * FROM drivers WHERE id = ?');
  const findDriverByMobile = db.prepare('SELECT * FROM drivers WHERE mobile = ?');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
  const updateOrderDriver = db.prepare('UPDATE orders SET driverId = ?, driverName = ?, status = ? WHERE id = ?');
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
    if (!mobile || !String(mobile).trim()) {
      return res.status(400).json({ success: false, message: 'mobile is required' });
    }
    const normalized = String(mobile).trim();
    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        verificationId: `driver_otp_${Date.now()}`,
        expiresIn: 300,
        mobile: normalized,
      },
    });
  });

  // POST /api/driver/login
  app.post('/api/driver/login', (req, res) => {
    const { mobile, otpCode } = req.body || {};
    if (!mobile || !otpCode) {
      return res.status(400).json({ success: false, message: 'mobile and otpCode are required' });
    }
    const driver = findDriverByMobile.get(String(mobile).trim());
    if (!driver) {
      return res.status(401).json({ success: false, message: 'Driver not found. Contact admin to be added.' });
    }
    if (driver.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account is blocked' });
    }
    const token = jwt.sign(
      { driverId: driver.id, mobile: driver.mobile },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const d = { ...driver };
    delete d.licenseNumber;
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
      const boxRows = db
        .prepare("SELECT * FROM arheb_box_requests WHERE driverId = ? AND LOWER(status) = 'assigned' ORDER BY createdAt DESC LIMIT 20")
        .all(driverId);
      arhebBoxAvailable = boxRows.map((r) => enrichArhebBoxRow(r, db));
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString().slice(0, 10);
    const todayOrders = db.prepare('SELECT * FROM orders WHERE driverId = ? AND status = ? AND date(createdAt) = ?').all(driverId, 'Delivered', todayStr);
    const allDelivered = db.prepare('SELECT * FROM orders WHERE driverId = ? AND status = ?').all(driverId, 'Delivered');
    const todayEarnings = todayOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const totalEarnings = allDelivered.reduce((s, o) => s + (o.deliveryFee || 0), 0);

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
    };
    const stats = {
      todayEarnings,
      todayOrders: todayOrders.length,
      totalEarnings,
      totalOrders: allDelivered.length,
      rating: req.driver.rating ?? 5,
    };

    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));
    const buildOrder = (order) => {
      const items = findOrderItems.all(order.id);
      const dr = order.driverId ? findDriverById.get(order.driverId) : null;
      const store = order.storeId ? storeById[order.storeId] : null;
      return orderToDriverApi(order, items, dr, store);
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
    const earnings = completed.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    return res.status(200).json({
      success: true,
      message: 'Stats loaded successfully',
      data: {
        period,
        stats: {
          earnings,
          earningsGrowth: 15,
          totalOrders: orders.length,
          completedOrders: completed.length,
          cancelledOrders: cancelled.length,
          avgDeliveryTime: 25,
          rating: req.driver.rating ?? 5,
          totalReviews: 0,
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
      return orderToDriverApi(o, items, findDriverByIdRun(o.driverId), store);
    });

    let arhebBoxAvailable = [];
    if (filter === 'available') {
      try {
        const boxRows = db
          .prepare("SELECT * FROM arheb_box_requests WHERE driverId = ? AND LOWER(status) = 'assigned' ORDER BY createdAt DESC LIMIT 50")
          .all(driverId);
        arhebBoxAvailable = boxRows.map((r) => enrichArhebBoxRow(r, db));
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Orders loaded successfully',
      data: {
        filter,
        page,
        perPage,
        total,
        orders: list,
        ...(filter === 'available' ? { arhebBoxAvailable, arhebBoxAvailableCount: arhebBoxAvailable.length } : {}),
      },
    });
  });

  // GET /api/driver/requests — pending delivery requests (admin requested this driver to pick up order)
  app.get('/api/driver/requests', driverAuth, (req, res) => {
    if (!findDriverRequestsByDriver) {
      return res.status(200).json({ success: true, data: { requests: [] } });
    }
    const rows = findDriverRequestsByDriver.all(req.driver.id, 'pending');
    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));
    const requests = rows.map((r) => {
      const order = findOrderById.get(r.orderId);
      if (!order || order.driverId != null) return null;
      const items = findOrderItems.all(r.orderId);
      const store = order.storeId ? storeById[order.storeId] : null;
      return {
        requestId: r.id,
        orderId: r.orderId,
        createdAt: r.createdAt,
        order: orderToDriverApi(order, items, null, store),
      };
    }).filter(Boolean);
    return res.status(200).json({
      success: true,
      message: 'Requests loaded',
      data: { requests },
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
      data: { order: orderToDriverApi(order, items, driverRow, store) },
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
    if (order.driverId != null) return res.status(400).json({ success: false, message: 'Order already assigned' });
    if (updateDriverRequestStatus) {
      const existing = db.prepare('SELECT id FROM driver_requests WHERE orderId = ? AND driverId = ? AND status = ?').get(orderId, driverId, 'pending');
      if (existing) {
        updateDriverRequestStatus.run('accepted', orderId, driverId);
        if (rejectOtherRequestsForOrder) rejectOtherRequestsForOrder.run('rejected', orderId, driverId);
      }
    }
    const driverRowForAccept = findDriverById.get(driverId);
    const driverName = driverRowForAccept ? driverRowForAccept.name : null;
    updateOrderDriver.run(driverId, driverName, 'On the way', orderId);
    emitOrderStatus(orderId, 'On the way');
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    const driverRow = findDriverById.get(driverId);
    const storesList = loadStores();
    const store = updated.storeId ? storesList.find((s) => s.id === updated.storeId) : null;
    return res.status(200).json({
      success: true,
      message: 'Order accepted successfully',
      data: { order: orderToDriverApi(updated, items, driverRow, store) },
    });
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
        data: { order: orderToDriverApi(order, items, driverRow, store) },
      });
    }
    if (st !== 'On the way') {
      return res.status(400).json({
        success: false,
        message: 'Order must be On the way before marking delivered. Accept the order first.',
      });
    }
    updateOrderStatus.run('Delivered', orderId);
    emitOrderStatus(orderId, 'Delivered');
    fcm.sendToUserByPhone(db, order.phoneNumber, 'Order delivered', `Order #${orderId} has been delivered. Thank you!`, null, { orderId: String(orderId), status: 'Delivered', type: 'order_status' }).catch(() => {});
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    const driverRow = findDriverById.get(driverId);
    const storesList = loadStores();
    const store = updated.storeId ? storesList.find((s) => s.id === updated.storeId) : null;
    return res.status(200).json({
      success: true,
      message: 'Order marked as delivered successfully',
      data: { order: orderToDriverApi(updated, items, driverRow, store) },
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
    if (row.driverId != null && row.driverId !== driverId) return res.status(403).json({ success: false, message: 'Request not assigned to you' });
    const statusLower = (row.status || '').toLowerCase();
    if (statusLower !== 'assigned') return res.status(400).json({ success: false, message: 'Request is not in assigned state' });
    db.prepare('UPDATE arheb_box_requests SET status = ? WHERE id = ?').run('in_progress', requestId);
    fcm.sendToToken(row.fcmToken, 'Arheb Box accepted', `A driver has accepted your request #${requestId}.`, null, { type: 'arheb_box_status', requestId: String(requestId), status: 'in_progress' }).catch(() => {});
    if (!row.fcmToken) fcm.sendToUserByPhone(db, row.phoneNumber, 'Arheb Box accepted', `A driver has accepted your request #${requestId}.`, null, { type: 'arheb_box_status', requestId: String(requestId), status: 'in_progress' }).catch(() => {});
    const updated = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
    return res.status(200).json({
      success: true,
      message: 'Arheb Box request accepted',
      data: {
        request: enrichArhebBoxRow(updated, db),
      },
    });
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
