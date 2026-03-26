const fs = require('fs');
const path = require('path');
const { enrichArhebBoxRow, calcArhebBoxDeliveryFeeJod } = require('../arhebBox');
const { quoteFromPickupDropoff } = require('../arhebBox/pricing');
const { mapOrderItemsRows } = require('../utils/orderItemApi');
const { validateSelectedAddOnsAgainstProduct } = require('../utils/productAddOns');

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

  /** 16% VAT applies to the delivery fee only (not order subtotal, not service fee). */
  function calcFeesTaxJod(deliveryFeeJod) {
    return round2(FEES_TAX_RATE * safeNumber(deliveryFeeJod, 0));
  }

  function buildOrderSummary(orderValueJod, deliveryFeeJod, serviceFeeJod) {
    const taxJod = calcFeesTaxJod(deliveryFeeJod);
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
    const taxJod = calcFeesTaxJod(deliveryFeeJod);
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

  /**
   * Pre-checkout quote: delivery + service + VAT (16% on delivery fee only).
   * Same delivery formula as Arheb Box (1 + 0.15 JOD/kg). Store location is resolved from storeId/mapsUrl.
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
      const deliveryFee = calcArhebBoxDeliveryFeeJod(weightKgNum);
      const serviceFee = SERVICE_FEE_JOD;
      const feesTax = calcFeesTaxJod(deliveryFee);
      const invoice = buildInvoice(deliveryFee, serviceFee);
      return res.status(200).json({
        success: true,
        data: {
          storeId: String(storeId),
          storeName: store.name ?? null,
          storeLocation,
          distanceKm: q.distanceKm,
          minAmountJod: q.minAmountJod,
          weightKg: round3(weightKgNum),
          currency: 'JOD',
          deliveryFee: invoice.deliveryFee,
          serviceFee: invoice.serviceFee,
          feesTaxRate: FEES_TAX_RATE,
          feesTax,
          feesTaxNote: '16% VAT on delivery fee only (not on order subtotal or service fee).',
          invoiceTotal: invoice.total,
          pricingNote:
            'Delivery fee matches Arheb Box: 1 JOD + 0.15 JOD/kg (uncapped). distanceKm and minAmountJod describe the route (same haversine rules as POST /api/arheb-box/quote).',
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
      const {
        items,
        name,
        phoneNumber,
        addressName,
        addressLong,
        addressLat,
        discount = 0,
        deliveryFee = 0,
        totalAmount,
        paymentType,
        promoCode,
        storeId,
        nearby,
        notes,
        paymentVerificationImage,
        fcmToken,
        weightKg
      } = req.body;

      // Validation
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Items array is required and must not be empty'
        });
      }

      // Validate each item
      for (const item of items) {
        if (!item.id || !item.name || item.price === undefined || !item.quantity) {
          return res.status(400).json({
            success: false,
            message: 'Each item must have id, name, price, and quantity'
          });
        }
      }

      // Validate add-ons against product JSON (addOnGroups / selectedAddOns)
      for (const item of items) {
        const product = findProductById(item.id);
        if (!product) {
          return res.status(400).json({
            success: false,
            message: `Product not found: ${item.id}`,
          });
        }
        const v = validateSelectedAddOnsAgainstProduct(product, item.selectedAddOns);
        if (!v.ok) {
          return res.status(400).json({
            success: false,
            message: v.message || 'Invalid add-ons',
          });
        }
        item._normalizedAddOns = v.normalized;
      }

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: 'phoneNumber is required'
        });
      }

      if (totalAmount === undefined || totalAmount === null) {
        return res.status(400).json({
          success: false,
          message: 'totalAmount is required'
        });
      }

      if (!paymentType) {
        return res.status(400).json({
          success: false,
          message: 'paymentType is required'
        });
      }

      let normalizedPaymentType = String(paymentType).trim();
      if (!normalizedPaymentType) {
        return res.status(400).json({
          success: false,
          message: 'paymentType is required'
        });
      }
      const lowerPaymentType = normalizedPaymentType.toLowerCase();

      if (paymentVerificationImage !== undefined && paymentVerificationImage !== null && typeof paymentVerificationImage !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'paymentVerificationImage must be a string (URL)'
        });
      }

      // Validate coordinates if provided
      if (addressLong !== undefined && (typeof addressLong !== 'number' || isNaN(addressLong))) {
        return res.status(400).json({
          success: false,
          message: 'addressLong must be a valid number'
        });
      }

      if (addressLat !== undefined && (typeof addressLat !== 'number' || isNaN(addressLat))) {
        return res.status(400).json({
          success: false,
          message: 'addressLat must be a valid number'
        });
      }

      // Validate and process promo code if provided
      let finalDiscount = discount || 0;
      let finalPromoCode = null;

      if (promoCode) {
        const promoCodeRecord = findPromoCodeByName.get(promoCode.trim());
        if (!promoCodeRecord) {
          return res.status(400).json({
            success: false,
            message: 'invalid promoCode'
          });
        }
        // Use promo code value as discount
        finalDiscount = promoCodeRecord.value;
        finalPromoCode = promoCodeRecord.name;
      } else {
        // Only validate discount if no promo code provided
        if (discount !== undefined && discount !== null && (typeof discount !== 'number' || isNaN(discount))) {
          return res.status(400).json({
            success: false,
            message: 'discount must be a valid number'
          });
        }
        if (discount !== undefined && discount !== null) {
          finalDiscount = discount;
        }
      }

      // deliveryFee is computed on server (weight-based). We accept client deliveryFee for backward compatibility but ignore it.

      if (typeof totalAmount !== 'number' || isNaN(totalAmount)) {
        return res.status(400).json({
          success: false,
          message: 'totalAmount must be a valid number'
        });
      }

      // Get storeId from first product if not provided
      let finalStoreId = storeId;
      if (!finalStoreId && items.length > 0 && items[0].id) {
        finalStoreId = getStoreIdFromProduct(items[0].id);
      }

      // Optionally update user FCM token for order status push notifications
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

      // Use transaction to ensure both order and items are created atomically
      const createOrder = db.transaction((orderData) => {
        // Insert order
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
            paymentVerificationImage
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
            @paymentVerificationImage
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
          paymentVerificationImage: orderData.paymentVerificationImage || null
        });

        const orderId = orderResult.lastInsertRowid;

        // Insert order items
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

      const initialStatus =
        lowerPaymentType === 'cliq' ? 'Waiting cliq confirmation' : 'Waiting confirmation';

      const weightKgNum = Math.max(0, safeNumber(weightKg, 0));
      const computedDeliveryFee = calcArhebBoxDeliveryFeeJod(weightKgNum);
      const computedServiceFee = SERVICE_FEE_JOD;
      const computedFeesTax = calcFeesTaxJod(computedDeliveryFee);

      const orderId = createOrder({
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
        items
      });

      // Fetch the created order
      const order = findOrderById.get(orderId);
      const findOrderItemsCreated = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      const itemsOut = mapOrderItemsRows(findOrderItemsCreated.all(orderId));

      return res.status(201).json({
        success: true,
        message: 'Order created successfully',
        data: {
          orderId: orderId,
          order: {
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
            feesTax: order.feesTax != null ? order.feesTax : calcFeesTaxJod(order.deliveryFee),
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
            createdAt: order.createdAt,
            items: itemsOut,
          },
        },
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
        const feesTax = order.feesTax != null ? Number(order.feesTax) : calcFeesTaxJod(order.deliveryFee);
        return {
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
          createdAt: order.createdAt,
          items: mapOrderItemsRows(items),
        };
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
      const feesTax = order.feesTax != null ? Number(order.feesTax) : calcFeesTaxJod(order.deliveryFee);

      return res.status(200).json({
        success: true,
        message: 'Order retrieved successfully',
        data: {
          order: {
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
            createdAt: order.createdAt,
            items: items.map(item => ({
              id: item.productId,
              name: item.productName,
              price: item.price,
              quantity: item.quantity
            }))
          }
        },
        timestamp: new Date().toISOString()
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
      const feesTax = updatedOrder.feesTax != null ? Number(updatedOrder.feesTax) : calcFeesTaxJod(updatedOrder.deliveryFee);

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

  // Validate/Check promo code
  app.get('/api/promo-codes/:code', (req, res) => {
    try {
      const code = req.params.code;

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
          message: 'promCode not available'
        });
      }

      return res.status(200).json({
        success: true,
        message: `promocode Value is ${promoCodeRecord.value}`,
        data: {
          value: promoCodeRecord.value,
          name: promoCodeRecord.name
        },
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
};
