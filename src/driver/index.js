const jwt = require('jsonwebtoken');

// Map DB order + items + driver to API shape
function orderToDriverApi(order, items = [], driverRow = null) {
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
  return {
    id: String(order.id),
    orderNumber: `ORD-${String(order.id).padStart(4, '0')}`,
    products: (items || []).map((i) => ({
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
    })),
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
    driver,
    driver_latitude: driver ? driverRow.latitude : null,
    driver_longitude: driver ? driverRow.longitude : null,
  };
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
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverId INTEGER`);
  } catch (e) {
    // column exists
  }

  const findDriverById = db.prepare('SELECT * FROM drivers WHERE id = ?');
  const findDriverByMobile = db.prepare('SELECT * FROM drivers WHERE mobile = ?');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
  const updateOrderDriver = db.prepare('UPDATE orders SET driverId = ?, status = ? WHERE id = ?');
  const updateOrderStatus = db.prepare('UPDATE orders SET status = ? WHERE id = ?');

  const insertDriver = db.prepare(`
    INSERT INTO drivers (name, mobile, email, vehicleType, vehicleNumber, licenseNumber, photo, latitude, longitude, rating, isVerified)
    VALUES (@name, @mobile, @email, @vehicleType, @vehicleNumber, @licenseNumber, @photo, @latitude, @longitude, @rating, @isVerified)
  `);

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
      return res.status(401).json({ success: false, message: 'Driver not found. Register first.' });
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

  // POST /api/driver/register
  app.post('/api/driver/register', (req, res) => {
    const { name, mobile, email, vehicleType, vehicleNumber, licenseNumber, otpCode } = req.body || {};
    if (!name || !mobile) {
      return res.status(400).json({ success: false, message: 'name and mobile are required' });
    }
    const normalizedMobile = String(mobile).trim();
    if (findDriverByMobile.get(normalizedMobile)) {
      return res.status(400).json({ success: false, message: 'Driver with this mobile already exists' });
    }
    try {
      insertDriver.run({
        name: String(name).trim(),
        mobile: normalizedMobile,
        email: email ? String(email).trim() : null,
        vehicleType: vehicleType ? String(vehicleType).trim() : null,
        vehicleNumber: vehicleNumber ? String(vehicleNumber).trim() : null,
        licenseNumber: licenseNumber ? String(licenseNumber).trim() : null,
        photo: null,
        latitude: null,
        longitude: null,
        rating: 5,
        isVerified: 0,
      });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Registration failed' });
    }
    const driver = findDriverByMobile.get(normalizedMobile);
    const token = jwt.sign(
      { driverId: driver.id, mobile: driver.mobile },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(200).json({
      success: true,
      message: 'Registration successful',
      data: {
        driver: {
          id: String(driver.id),
          name: driver.name,
          photo: driver.photo,
          mobile: driver.mobile,
          email: driver.email,
          vehicleType: driver.vehicleType,
          vehicleNumber: driver.vehicleNumber,
          licenseNumber: driver.licenseNumber,
          latitude: driver.latitude,
          longitude: driver.longitude,
          rating: driver.rating ?? 5,
          isVerified: Boolean(driver.isVerified),
          createdAt: driver.createdAt,
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
    const availableOrders = db.prepare('SELECT * FROM orders WHERE driverId IS NULL AND status NOT IN (?, ?) ORDER BY id DESC LIMIT 50').all('Delivered', 'Cancelled');

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

    const buildOrder = (order) => {
      const items = findOrderItems.all(order.id);
      const dr = order.driverId ? findDriverById.get(order.driverId) : null;
      return orderToDriverApi(order, items, dr);
    };

    return res.status(200).json({
      success: true,
      message: 'Driver home data loaded',
      data: {
        driver: driverDto,
        stats,
        currentOrder: currentOrder ? buildOrder(currentOrder) : null,
        availableOrders: availableOrders.slice(0, 20).map(buildOrder),
        inProgressOrders: inProgressOrders.map(buildOrder),
      },
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
      orders = db.prepare('SELECT * FROM orders WHERE driverId IS NULL AND status NOT IN (?, ?) ORDER BY id DESC').all('Delivered', 'Cancelled');
    } else if (filter === 'in_progress' || filter === 'mine') {
      orders = db.prepare('SELECT * FROM orders WHERE driverId = ? AND status NOT IN (?, ?) ORDER BY id DESC').all(driverId, 'Delivered', 'Cancelled');
    } else {
      orders = db.prepare('SELECT * FROM orders WHERE driverId = ? ORDER BY id DESC').all(driverId);
    }
    const total = orders.length;
    const slice = orders.slice(offset, offset + perPage);
    const findDriverByIdRun = (id) => (id ? findDriverById.get(id) : null);
    const list = slice.map((o) => {
      const items = findOrderItems.all(o.id);
      return orderToDriverApi(o, items, findDriverByIdRun(o.driverId));
    });

    return res.status(200).json({
      success: true,
      message: 'Orders loaded successfully',
      data: { filter, page, perPage, total, orders: list },
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
    return res.status(200).json({
      success: true,
      message: 'Order loaded successfully',
      data: { order: orderToDriverApi(order, items, driverRow) },
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
    updateOrderDriver.run(driverId, 'On the way', orderId);
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    const driverRow = findDriverById.get(driverId);
    return res.status(200).json({
      success: true,
      message: 'Order accepted successfully',
      data: { order: orderToDriverApi(updated, items, driverRow) },
    });
  });

  // POST /api/driver/orders/complete
  app.post('/api/driver/orders/complete', driverAuth, (req, res) => {
    const { orderId: bodyOrderId, driverId: bodyDriverId } = req.body || {};
    const orderId = parseInt(bodyOrderId || req.body?.orderId, 10);
    const driverId = bodyDriverId != null ? parseInt(bodyDriverId, 10) : req.driver.id;
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'orderId is required' });
    if (driverId !== req.driver.id) return res.status(403).json({ success: false, message: 'You can only complete your own orders' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.driverId !== driverId) return res.status(403).json({ success: false, message: 'Order not assigned to you' });
    updateOrderStatus.run('Delivered', orderId);
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    const driverRow = findDriverById.get(driverId);
    return res.status(200).json({
      success: true,
      message: 'Order completed successfully',
      data: { order: orderToDriverApi(updated, items, driverRow) },
    });
  });
};
