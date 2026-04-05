const fs = require('fs');
const path = require('path');
const { enrichArhebBoxRow, calcArhebBoxDeliveryFeeJod } = require('../arhebBox');
const { quoteFromPickupDropoff } = require('../arhebBox/pricing');
const { storeOrderDeliveryFeeJod, STORE_MAX_JOD } = require('../utils/deliveryFees');
const { mapOrderItemsRows } = require('../utils/orderItemApi');
const { enrichWithJordanTime } = require('../utils/jordanTime');
const { promoAppliesToStore } = require('../utils/promoCode');
const { validateSelectedAddOnsAgainstProduct } = require('../utils/productAddOns');
const { sendToStore } = require('../fcm');
const { canonicalStoreId } = require('../storeFcm');

module.exports = function attachCheckoutRoutes(app, db, authenticateRequest) {
  const { getJsonPath } = require('../config/jsonPaths');
  const SERVICE_FEE_JOD = 0.65;
  const FEES_TAX_RATE = 0.07;

  function round3(n) {
    return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function safeNumber(v, fallback = 0) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** 7% tax on delivery fee + service fee (default service 0.65 JOD); not on order subtotal. */
  function calcFeesTaxJod(deliveryFeeJod, serviceFeeJod) {
    return round2(
      FEES_TAX_RATE * (safeNumber(deliveryFeeJod, 0) + safeNumber(serviceFeeJod, 0)),
    );
  }

  function buildOrderSummary(orderValueJod, deliveryFeeJod, serviceFeeJod) {
    const taxJod = calcFeesTaxJod(deliveryFeeJod, serviceFeeJod);
    return {
      currency: 'JOD',
      orderValue: round2(safeNumber(orderValueJod, 0)),
      deliveryFee: round2(safeNumber(deliveryFeeJod, 0)),
      serviceFee: round2(safeNumber(serviceFeeJod, 0)),
      feesTaxRate: FEES_TAX_RATE,
      feesTax: taxJod,
      total: round2(safeNumber(orderValueJod, 0) + safeNumber(deliveryFeeJod, 0) + safeNumber(serviceFeeJod, 0) + taxJod),
    };
  }

  function buildInvoice(deliveryFeeJod, serviceFeeJod) {
    const taxJod = calcFeesTaxJod(deliveryFeeJod, serviceFeeJod);
    return {
      currency: 'JOD',
      deliveryFee: round2(safeNumber(deliveryFeeJod, 0)),
      serviceFee: round2(safeNumber(serviceFeeJod, 0)),
      feesTaxRate: FEES_TAX_RATE,
      feesTax: taxJod,
      total: round2(safeNumber(deliveryFeeJod, 0) + safeNumber(serviceFeeJod, 0) + taxJod),
    };
  }
  // Helper function to get storeId from first product if not provided
  const getStoreIdFromProduct = (productId) => {
    const p = findProductById(productId);
    return p?.store?.id || null;
  };

  function findProductById(productId) {
    try {
      const productsResponsePath = getJsonPath('products_listing_response.json');
      const raw = fs.readFileSync(productsResponsePath, 'utf-8');
      const productsResponse = JSON.parse(raw);
      const products = productsResponse?.data?.products ?? [];
      return products.find((p) => String(p.id) === String(productId)) || null;
    } catch (error) {
      console.error('Failed to load product:', error);
      return null;
    }
  }

  function loadStoreFromJsonById(storeId) {
    try {
      const storesResponsePath = getJsonPath('stores_listing_response.json');
      const raw = fs.readFileSync(storesResponsePath, 'utf-8');
      const stores = JSON.parse(raw)?.data?.stores ?? [];
      return stores.find((s) => String(s.id) === String(storeId)) || null;
    } catch (error) {
      console.error('Failed to load store:', error);
      return null;
    }
  }

  function parseLatLongFromGoogleMapsUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const text = url.trim();
    const patterns = [
      /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
      /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const latitude = Number(m[1]);
        const longitude = Number(m[2]);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
      }
    }
    return null;
  }
  // Create promo_codes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      value REAL NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try {
    db.exec(`ALTER TABLE promo_codes ADD COLUMN storeId TEXT`);
  } catch (e) {
    /* exists */
  }

  // Create orders and order_items tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      phoneNumber TEXT NOT NULL,
      name TEXT,
      addressName TEXT,
      addressLong REAL,
      addressLat REAL,
      discount REAL DEFAULT 0,
      deliveryFee REAL DEFAULT 0,
      serviceFee REAL DEFAULT 0.65,
      feesTax REAL DEFAULT 0,
      weightKg REAL DEFAULT 0,
      totalAmount REAL NOT NULL,
      status TEXT DEFAULT 'Waiting confirmation',
      paymentType TEXT NOT NULL,
      promoCode TEXT,
      orderRating INTEGER DEFAULT 0,
      storeId TEXT,
      nearby TEXT,
      notes TEXT,
      paymentVerificationImage TEXT,
      nearArrivalNotified INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phoneNumber) REFERENCES users(phoneNumber)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  // Add new columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN deliveryFee REAL DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }
  try { db.exec(`ALTER TABLE orders ADD COLUMN serviceFee REAL DEFAULT 0.65`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN feesTax REAL DEFAULT 0`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN weightKg REAL DEFAULT 0`); } catch (e) { /* exists */ }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN promoCode TEXT`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN orderRating INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN storeId TEXT`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN paymentVerificationImage TEXT`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN nearArrivalNotified INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE order_items ADD COLUMN selectedAddOns TEXT`);
  } catch (e) {
    // Column already exists
  }
  try { db.exec(`ALTER TABLE orders ADD COLUMN paymentTranRef TEXT`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN paymentCartId TEXT`); } catch (e) { /* exists */ }

  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const findOrdersByUserId = db.prepare('SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC');
  
  // Promo code queries
  const findPromoCodeByName = db.prepare('SELECT * FROM promo_codes WHERE name = ?');
  
  // Store rating queries
  const findStoreById = db.prepare('SELECT * FROM store_listings WHERE id = ?');
  const updateStoreRating = db.prepare(`
    UPDATE store_listings 
    SET rate = @newRate, numberOfReviews = @numberOfReviews 
    WHERE id = @storeId
  `);

  const createOrder = db.transaction((orderData) => {
    const insertOrder = db.prepare(`
          INSERT INTO orders (
            userId,
            phoneNumber,
            name,
            addressName,
            addressLong,
            addressLat,
            discount,
            deliveryFee,
            serviceFee,
            feesTax,
            weightKg,
            totalAmount,
            status,
            paymentType,
            promoCode,
            orderRating,
            storeId,
            nearby,
            notes,
            paymentVerificationImage,
            paymentTranRef,
            paymentCartId
          ) VALUES (
            @userId,
            @phoneNumber,
            @name,
            @addressName,
            @addressLong,
            @addressLat,
            @discount,
            @deliveryFee,
            @serviceFee,
            @feesTax,
            @weightKg,
            @totalAmount,
            @status,
            @paymentType,
            @promoCode,
            @orderRating,
            @storeId,
            @nearby,
            @notes,
            @paymentVerificationImage,
            @paymentTranRef,
            @paymentCartId
          )
        `);

    const orderResult = insertOrder.run({
      userId: orderData.userId,
      phoneNumber: orderData.phoneNumber,
      name: orderData.name || null,
      addressName: orderData.addressName || null,
      addressLong: orderData.addressLong || null,
      addressLat: orderData.addressLat || null,
      discount: orderData.discount || 0,
      deliveryFee: orderData.deliveryFee || 0,
      serviceFee: orderData.serviceFee != null ? orderData.serviceFee : SERVICE_FEE_JOD,
      feesTax: orderData.feesTax || 0,
      weightKg: orderData.weightKg || 0,
      totalAmount: orderData.totalAmount,
      status: orderData.status,
      paymentType: orderData.paymentType,
      promoCode: orderData.promoCode,
      orderRating: 0,
      storeId: orderData.storeId,
      nearby: orderData.nearby || null,
      notes: orderData.notes || null,
      paymentVerificationImage: orderData.paymentVerificationImage || null,
      paymentTranRef: orderData.paymentTranRef ?? null,
      paymentCartId: orderData.paymentCartId ?? null,
    });

    const orderId = orderResult.lastInsertRowid;

    const insertOrderItem = db.prepare(`
          INSERT INTO order_items (
            orderId,
            productId,
            productName,
            price,
            quantity,
            selectedAddOns
          ) VALUES (
            @orderId,
            @productId,
            @productName,
            @price,
            @quantity,
            @selectedAddOns
          )
        `);

    for (const item of orderData.items) {
      const addOnsObj = item._normalizedAddOns || {};
      const addOnsStr = Object.keys(addOnsObj).length ? JSON.stringify(addOnsObj) : null;
      insertOrderItem.run({
        orderId: orderId,
        productId: item.id,
        productName: item.name,
        price: item.price,
        quantity: item.quantity,
        selectedAddOns: addOnsStr,
      });
    }

    return orderId;
  });

  /**
   * Shared order creation (used by POST /api/checkout and POST /api/payment/initiate).
   * @param {string} userId - From JWT (userId or phone)
   * @param {object} body - Same shape as POST /api/checkout body
   * @param {{ forcePaymentType?: string, initialStatusOverride?: string }} options
   */
  function createOrderFromCheckoutBody(userId, body, options = {}) {
    const {
      items,
      name,
      phoneNumber,
      addressName,
      addressLong,
      addressLat,
      discount = 0,
      totalAmount,
      paymentType,
      promoCode,
      storeId,
      nearby,
      notes,
      paymentVerificationImage,
      fcmToken,
      weightKg,
    } = body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { ok: false, statusCode: 400, message: 'Items array is required and must not be empty' };
    }

    const itemsCopy = items.map((item) => ({ ...item }));

    for (const item of itemsCopy) {
      if (!item.id || !item.name || item.price === undefined || !item.quantity) {
        return { ok: false, statusCode: 400, message: 'Each item must have id, name, price, and quantity' };
      }
    }

    for (const item of itemsCopy) {
      const product = findProductById(item.id);
      if (!product) {
        return { ok: false, statusCode: 400, message: `Product not found: ${item.id}` };
      }
      const v = validateSelectedAddOnsAgainstProduct(product, item.selectedAddOns);
      if (!v.ok) {
        return { ok: false, statusCode: 400, message: v.message || 'Invalid add-ons' };
      }
      item._normalizedAddOns = v.normalized;
    }

    let finalStoreId = storeId;
    if (!finalStoreId && itemsCopy.length > 0 && itemsCopy[0].id) {
      finalStoreId = getStoreIdFromProduct(itemsCopy[0].id);
    }
    if (finalStoreId != null && String(finalStoreId).trim() !== '') {
      finalStoreId = canonicalStoreId(finalStoreId) || String(finalStoreId).trim();
    } else {
      finalStoreId = null;
    }

    if (!phoneNumber) {
      return { ok: false, statusCode: 400, message: 'phoneNumber is required' };
    }

    if (totalAmount === undefined || totalAmount === null) {
      return { ok: false, statusCode: 400, message: 'totalAmount is required' };
    }

    let normalizedPaymentType;
    if (options.forcePaymentType) {
      normalizedPaymentType = String(options.forcePaymentType).trim();
    } else {
      if (!paymentType) {
        return { ok: false, statusCode: 400, message: 'paymentType is required' };
      }
      normalizedPaymentType = String(paymentType).trim();
      if (!normalizedPaymentType) {
        return { ok: false, statusCode: 400, message: 'paymentType is required' };
      }
    }

    const lowerPaymentType = normalizedPaymentType.toLowerCase();

    if (paymentVerificationImage !== undefined && paymentVerificationImage !== null && typeof paymentVerificationImage !== 'string') {
      return { ok: false, statusCode: 400, message: 'paymentVerificationImage must be a string (URL)' };
    }

    if (addressLong !== undefined && (typeof addressLong !== 'number' || isNaN(addressLong))) {
      return { ok: false, statusCode: 400, message: 'addressLong must be a valid number' };
    }

    if (addressLat !== undefined && (typeof addressLat !== 'number' || isNaN(addressLat))) {
      return { ok: false, statusCode: 400, message: 'addressLat must be a valid number' };
    }

    let finalDiscount = discount || 0;
    let finalPromoCode = null;

    if (promoCode) {
      const promoCodeRecord = findPromoCodeByName.get(promoCode.trim());
      if (!promoCodeRecord) {
        return { ok: false, statusCode: 400, message: 'invalid promoCode' };
      }
      if (!promoAppliesToStore(promoCodeRecord, finalStoreId)) {
        return { ok: false, statusCode: 400, message: 'promo code not available for this store' };
      }
      finalDiscount = promoCodeRecord.value;
      finalPromoCode = promoCodeRecord.name;
    } else {
      if (discount !== undefined && discount !== null && (typeof discount !== 'number' || isNaN(discount))) {
        return { ok: false, statusCode: 400, message: 'discount must be a valid number' };
      }
      if (discount !== undefined && discount !== null) {
        finalDiscount = discount;
      }
    }

    if (typeof totalAmount !== 'number' || isNaN(totalAmount)) {
      return { ok: false, statusCode: 400, message: 'totalAmount must be a valid number' };
    }

    if (fcmToken != null && typeof fcmToken === 'string' && phoneNumber) {
      const trimmed = fcmToken.trim();
      if (trimmed) {
        try {
          db.prepare('UPDATE users SET fcmToken = ? WHERE phoneNumber = ?').run(trimmed, phoneNumber);
        } catch (e) {
          // ignore
        }
      }
    }

    let initialStatus;
    if (options.initialStatusOverride) {
      initialStatus = options.initialStatusOverride;
    } else {
      initialStatus = lowerPaymentType === 'cliq' ? 'Waiting cliq confirmation' : 'Waiting confirmation';
    }

    const weightKgNum = Math.max(0, safeNumber(weightKg, 0));
    /** Non-store checkout (edge): legacy weight-only floor. Store orders use distance fee below. */
    let computedDeliveryFee = calcArhebBoxDeliveryFeeJod(weightKgNum);
    if (finalStoreId != null && String(finalStoreId).trim() !== '') {
      /** Store orders: 1 JOD first km + 0.1/km extra, max 3 JOD (distance-only). */
      if (
        typeof addressLat === 'number' &&
        !Number.isNaN(addressLat) &&
        typeof addressLong === 'number' &&
        !Number.isNaN(addressLong)
      ) {
        const st = loadStoreFromJsonById(finalStoreId);
        if (st) {
          const storeLoc =
            (st.latitude != null && st.longitude != null)
              ? { latitude: Number(st.latitude), longitude: Number(st.longitude) }
              : parseLatLongFromGoogleMapsUrl(st.mapsUrl);
          if (storeLoc) {
            const qOrder = quoteFromPickupDropoff(storeLoc, {
              latitude: addressLat,
              longitude: addressLong,
            });
            if (qOrder) {
              computedDeliveryFee = storeOrderDeliveryFeeJod(qOrder.distanceKm);
            } else {
              computedDeliveryFee = storeOrderDeliveryFeeJod(0);
            }
          } else {
            computedDeliveryFee = storeOrderDeliveryFeeJod(0);
          }
        } else {
          computedDeliveryFee = storeOrderDeliveryFeeJod(0);
        }
      } else {
        computedDeliveryFee = storeOrderDeliveryFeeJod(0);
      }
    }
    const computedServiceFee = SERVICE_FEE_JOD;
    const computedFeesTax = calcFeesTaxJod(computedDeliveryFee, computedServiceFee);

    let orderId;
    try {
      orderId = createOrder({
        userId,
        phoneNumber,
        name: name || null,
        addressName: addressName || null,
        addressLong: addressLong || null,
        addressLat: addressLat || null,
        discount: finalDiscount,
        deliveryFee: computedDeliveryFee,
        serviceFee: computedServiceFee,
        feesTax: computedFeesTax,
        weightKg: round3(weightKgNum),
        totalAmount,
        status: initialStatus,
        paymentType: normalizedPaymentType,
        promoCode: finalPromoCode,
        storeId: finalStoreId,
        nearby: nearby || null,
        notes: notes || null,
        paymentVerificationImage: paymentVerificationImage || null,
        items: itemsCopy,
      });
    } catch (e) {
      console.error('createOrderFromCheckoutBody error:', e);
      return { ok: false, statusCode: 500, message: 'Internal server error' };
    }

    if (finalStoreId != null && String(finalStoreId).trim() !== '') {
      const sid = String(finalStoreId).trim();
      Promise.resolve()
        .then(() =>
          sendToStore(db, sid, 'New order', `Order #${orderId}`, {
            orderId: String(orderId),
            storeId: sid,
            type: 'store_new_order',
          }),
        )
        .catch(() => {});
    }

    const order = findOrderById.get(orderId);
    const findOrderItemsCreated = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
    const itemsOut = mapOrderItemsRows(findOrderItemsCreated.all(orderId));

    const checkoutPayload = {
      orderId,
      order: enrichWithJordanTime(
        {
          id: order.id,
          userId: order.userId,
          phoneNumber: order.phoneNumber,
          name: order.name,
          addressName: order.addressName,
          addressLong: order.addressLong,
          addressLat: order.addressLat,
          discount: order.discount,
          deliveryFee: order.deliveryFee,
          serviceFee: order.serviceFee != null ? order.serviceFee : SERVICE_FEE_JOD,
          feesTax:
            order.feesTax != null
              ? order.feesTax
              : calcFeesTaxJod(order.deliveryFee, order.serviceFee ?? SERVICE_FEE_JOD),
          weightKg: order.weightKg != null ? order.weightKg : round3(weightKgNum),
          totalAmount: order.totalAmount,
          orderSummary: buildOrderSummary(order.totalAmount, order.deliveryFee, order.serviceFee ?? SERVICE_FEE_JOD),
          invoice: buildInvoice(order.deliveryFee, order.serviceFee ?? SERVICE_FEE_JOD),
          status: order.status,
          paymentType: order.paymentType,
          promoCode: order.promoCode || null,
          orderRating: order.orderRating || 0,
          nearby: order.nearby,
          notes: order.notes,
          storeId: order.storeId ?? null,
          paymentTranRef: order.paymentTranRef ?? null,
          paymentCartId: order.paymentCartId ?? null,
          createdAt: order.createdAt,
          items: itemsOut,
        },
        ['createdAt'],
      ),
    };

    return {
      ok: true,
      orderId,
      order,
      itemsOut,
      weightKgNum,
      checkoutPayload,
    };
  }

  /**
   * Pre-checkout quote: delivery + service + tax (7% on delivery fee only).
   * Store delivery fee: 1 JOD first km + 0.1 JOD per additional km, max 3 JOD.
   */
  app.post('/api/checkout/quote-fees', authenticateRequest, (req, res) => {
    try {
      const { storeId, deliveryLocation, weightKg } = req.body || {};
      if (storeId === undefined || storeId === null || String(storeId).trim() === '') {
        return res.status(400).json({ success: false, message: 'storeId is required' });
      }
      if (!deliveryLocation || typeof deliveryLocation !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'deliveryLocation is required (object with latitude and longitude)',
        });
      }
      const store = loadStoreFromJsonById(storeId);
      if (!store) {
        return res.status(404).json({ success: false, message: 'Store not found' });
      }
      const storeLocation =
        (store.latitude != null && store.longitude != null)
          ? { latitude: Number(store.latitude), longitude: Number(store.longitude) }
          : parseLatLongFromGoogleMapsUrl(store.mapsUrl);
      if (!storeLocation) {
        return res.status(400).json({
          success: false,
          message: 'Store location is unavailable. Please set store mapsUrl with coordinates.',
        });
      }
      const q = quoteFromPickupDropoff(storeLocation, deliveryLocation);
      if (!q) {
        return res.status(400).json({
          success: false,
          message: 'deliveryLocation must include valid latitude and longitude',
        });
      }
      const weightKgNum = Math.max(0, safeNumber(weightKg, 0));
      const deliveryFee = storeOrderDeliveryFeeJod(q.distanceKm);
      const serviceFee = SERVICE_FEE_JOD;
      const invoice = buildInvoice(deliveryFee, serviceFee);
      return res.status(200).json({
        success: true,
        data: {
          storeId: String(storeId),
          storeName: store.name ?? null,
          storeLocation,
          distanceKm: q.distanceKm,
          deliveryFeeMaxJod: STORE_MAX_JOD,
          weightKg: round3(weightKgNum),
          currency: 'JOD',
          deliveryFee: invoice.deliveryFee,
          serviceFee: invoice.serviceFee,
          feesTaxRate: FEES_TAX_RATE,
          feesTax: invoice.feesTax,
          feesTaxNote: '7% tax on delivery fee plus service fee (not on order subtotal).',
          invoiceTotal: invoice.total,
          pricingNote:
            'Store delivery fee: 1 JOD for the first km + 0.1 JOD per additional km, maximum ' +
            STORE_MAX_JOD +
            ' JOD. Weight does not change delivery fee.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Checkout quote-fees error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Create order
  app.post('/api/checkout', authenticateRequest, (req, res) => {
    try {
      const userId = req.user.userId || req.user.phoneNumber;
      const result = createOrderFromCheckoutBody(userId, req.body, {});
      if (!result.ok) {
        return res.status(result.statusCode).json({
          success: false,
          message: result.message,
        });
      }
      return res.status(201).json({
        success: true,
        message: 'Order created successfully',
        data: result.checkoutPayload,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Checkout error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Get all orders for the authenticated user
  app.get('/api/checkout', authenticateRequest, (req, res) => {
    try {
      const userId = req.user.userId || req.user.phoneNumber;

      // Fetch all orders for this user
      const orders = findOrdersByUserId.all(userId);

      // Fetch items for each order
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      
      // All orders for this user, including every status (Waiting confirmation, Preparing, On the way, Delivered, Cancelled, etc.)
      const ordersWithItems = orders.map(order => {
        const items = findOrderItems.all(order.id);
        const serviceFee = order.serviceFee != null ? Number(order.serviceFee) : SERVICE_FEE_JOD;
        const feesTax =
          order.feesTax != null ? Number(order.feesTax) : calcFeesTaxJod(order.deliveryFee, serviceFee);
        return enrichWithJordanTime(
          {
            id: order.id,
            userId: order.userId,
            phoneNumber: order.phoneNumber,
            name: order.name,
            addressName: order.addressName,
            addressLong: order.addressLong,
            addressLat: order.addressLat,
            discount: order.discount,
            deliveryFee: order.deliveryFee,
            serviceFee,
            feesTax,
            weightKg: order.weightKg != null ? Number(order.weightKg) : 0,
            totalAmount: order.totalAmount,
            orderSummary: buildOrderSummary(order.totalAmount, order.deliveryFee, serviceFee),
            invoice: buildInvoice(order.deliveryFee, serviceFee),
            status: order.status,
            storeId: order.storeId ?? null,
            driverId: order.driverId ?? null,
            driverName: order.driverName ?? null,
            paymentType: order.paymentType,
            promoCode: order.promoCode || null,
            orderRating: order.orderRating || 0,
            nearby: order.nearby,
            notes: order.notes,
            paymentVerificationImage: order.paymentVerificationImage || null,
            paymentTranRef: order.paymentTranRef ?? null,
            paymentCartId: order.paymentCartId ?? null,
            createdAt: order.createdAt,
            items: mapOrderItemsRows(items),
          },
          ['createdAt'],
        );
      });

      let arhebBoxRequests = [];
      try {
        const boxRows = db
          .prepare('SELECT * FROM arheb_box_requests WHERE phoneNumber = ? ORDER BY createdAt DESC, id DESC')
          .all(userId);
        arhebBoxRequests = boxRows.map((r) => enrichArhebBoxRow(r, db));
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }

      return res.status(200).json({
        success: true,
        message: 'Orders retrieved successfully',
        data: {
          orders: ordersWithItems,
          count: ordersWithItems.length,
          arhebBoxRequests,
          arhebBoxCount: arhebBoxRequests.length,
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get orders error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Get order by ID (optional - for retrieving order details)
  app.get('/api/checkout/:orderId', authenticateRequest, (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.user.phoneNumber;

      if (isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid order ID'
        });
      }

      const order = findOrderById.get(orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      // Verify the order belongs to the authenticated user
      if (order.userId !== userId && order.phoneNumber !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Fetch order items
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      const items = findOrderItems.all(orderId);
      const serviceFee = order.serviceFee != null ? Number(order.serviceFee) : SERVICE_FEE_JOD;
      const feesTax =
        order.feesTax != null
          ? Number(order.feesTax)
          : calcFeesTaxJod(order.deliveryFee, serviceFee);

      return res.status(200).json({
        success: true,
        message: 'Order retrieved successfully',
        data: {
          order: enrichWithJordanTime(
            {
              id: order.id,
              userId: order.userId,
              phoneNumber: order.phoneNumber,
              name: order.name,
              addressName: order.addressName,
              addressLong: order.addressLong,
              addressLat: order.addressLat,
              discount: order.discount,
              deliveryFee: order.deliveryFee,
              serviceFee,
              feesTax,
              weightKg: order.weightKg != null ? Number(order.weightKg) : 0,
              totalAmount: order.totalAmount,
              orderSummary: buildOrderSummary(order.totalAmount, order.deliveryFee, serviceFee),
              invoice: buildInvoice(order.deliveryFee, serviceFee),
              status: order.status,
              storeId: order.storeId ?? null,
              driverId: order.driverId ?? null,
              driverName: order.driverName ?? null,
              paymentType: order.paymentType,
              promoCode: order.promoCode || null,
              orderRating: order.orderRating || 0,
              nearby: order.nearby,
              notes: order.notes,
              paymentVerificationImage: order.paymentVerificationImage || null,
              paymentTranRef: order.paymentTranRef ?? null,
              paymentCartId: order.paymentCartId ?? null,
              createdAt: order.createdAt,
              items: items.map((item) => ({
                id: item.productId,
                name: item.productName,
                price: item.price,
                quantity: item.quantity,
              })),
            },
            ['createdAt'],
          ),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Get order error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Rate an order
  app.put('/api/checkout/:orderId/rate', authenticateRequest, (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const userId = req.user.phoneNumber;
      const { rating } = req.body;

      if (isNaN(orderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid order ID'
        });
      }

      // Validate rating
      if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be an integer between 1 and 5'
        });
      }

      const order = findOrderById.get(orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      // Verify the order belongs to the authenticated user
      if (order.userId !== userId && order.phoneNumber !== userId) {
        return res.status(403).json({
          success: false,
          message: "Can't rate this order"
        });
      }

      // Update order rating
      const updateOrderRating = db.prepare('UPDATE orders SET orderRating = ? WHERE id = ?');
      updateOrderRating.run(rating, orderId);

      // If storeId exists, update store rating
      if (order.storeId) {
        const store = findStoreById.get(order.storeId);
        if (store) {
          const oldRate = store.rate || 0;
          const oldNumberOfReviews = store.numberOfReviews || 0;
          
          // Calculate new average rate: (oldRate * oldNumberOfReviews + newRating) / (oldNumberOfReviews + 1)
          const newNumberOfReviews = oldNumberOfReviews + 1;
          const newRate = ((oldRate * oldNumberOfReviews) + rating) / newNumberOfReviews;

          // Update store rating
          updateStoreRating.run({
            newRate: newRate,
            numberOfReviews: newNumberOfReviews,
            storeId: order.storeId
          });
        }
      }

      // Fetch updated order
      const updatedOrder = findOrderById.get(orderId);
      
      // Fetch order items
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      const items = findOrderItems.all(orderId);
      const serviceFee = updatedOrder.serviceFee != null ? Number(updatedOrder.serviceFee) : SERVICE_FEE_JOD;
      const feesTax =
        updatedOrder.feesTax != null
          ? Number(updatedOrder.feesTax)
          : calcFeesTaxJod(updatedOrder.deliveryFee, serviceFee);

      return res.status(200).json({
        success: true,
        message: 'Order rated successfully',
        data: {
          order: {
            id: updatedOrder.id,
            userId: updatedOrder.userId,
            phoneNumber: updatedOrder.phoneNumber,
            name: updatedOrder.name,
            addressName: updatedOrder.addressName,
            addressLong: updatedOrder.addressLong,
            addressLat: updatedOrder.addressLat,
            discount: updatedOrder.discount,
            deliveryFee: updatedOrder.deliveryFee,
            serviceFee,
            feesTax,
            weightKg: updatedOrder.weightKg != null ? Number(updatedOrder.weightKg) : 0,
            totalAmount: updatedOrder.totalAmount,
            orderSummary: buildOrderSummary(updatedOrder.totalAmount, updatedOrder.deliveryFee, serviceFee),
            invoice: buildInvoice(updatedOrder.deliveryFee, serviceFee),
            status: updatedOrder.status,
            paymentType: updatedOrder.paymentType,
            promoCode: updatedOrder.promoCode || null,
            orderRating: updatedOrder.orderRating,
            nearby: updatedOrder.nearby,
            notes: updatedOrder.notes,
            createdAt: updatedOrder.createdAt,
            items: mapOrderItemsRows(items),
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Rate order error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  // Validate/Check promo code (optional query: storeId — must match when code is store-specific)
  app.get('/api/promo-codes/:code', (req, res) => {
    try {
      const code = req.params.code;
      const storeIdQ =
        req.query.storeId != null && String(req.query.storeId).trim() !== ''
          ? String(req.query.storeId).trim()
          : null;

      if (!code || code.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Promo code is required'
        });
      }

      const promoCodeRecord = findPromoCodeByName.get(code.trim());

      if (!promoCodeRecord) {
        return res.status(404).json({
          success: false,
          message: 'promo code not available'
        });
      }

      if (storeIdQ != null && !promoAppliesToStore(promoCodeRecord, storeIdQ)) {
        return res.status(404).json({
          success: false,
          message: 'promo code not available for this store'
        });
      }

      const data = {
        value: promoCodeRecord.value,
        name: promoCodeRecord.name,
        appliesToAllStores:
          promoCodeRecord.storeId == null || String(promoCodeRecord.storeId).trim() === '',
      };
      if (!data.appliesToAllStores) {
        data.storeId = String(promoCodeRecord.storeId).trim();
      }

      return res.status(200).json({
        success: true,
        message: `promocode Value is ${promoCodeRecord.value}`,
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Validate promo code error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  attachCheckoutRoutes.createOrderFromCheckoutBody = createOrderFromCheckoutBody;
};
