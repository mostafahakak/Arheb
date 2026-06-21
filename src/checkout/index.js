const fs = require('fs');
const path = require('path');
const { enrichArhebBoxRow, calcArhebBoxDeliveryFeeJod } = require('../arhebBox');
const { quoteFromPickupDropoff } = require('../arhebBox/pricing');
const {
  storeOrderDeliveryFeeDistanceOnly,
  STORE_ORDER_SERVICE_FEE_JOD,
  resolveStoreOrderServiceFeeJod,
  resolveStoreOrderDeliveryFeeJod,
  resolveStoreOrderDeliveryFeeJodDetailed,
} = require('../utils/deliveryFees');
const { getPlatformCheckoutFeeTiers, ensurePlatformCheckoutFeesTable } = require('../utils/platformCheckoutFees');
const { seedDefaultDeliveryFixedZonesIfEmpty } = require('../utils/deliveryFixedZones');
const { mapOrderItemsRows } = require('../utils/orderItemApi');
const { enrichWithJordanTime, nowOrderCreatedAtForDb } = require('../utils/jordanTime');
const { promoAppliesToStore, promoMinAmountOk } = require('../utils/promoCode');
const { validateSelectedAddOnsAgainstProduct } = require('../utils/productAddOns');
const { sendToStore } = require('../fcm');
const { canonicalStoreId } = require('../storeFcm');
const {
  isPaymentTypeAllowedForStore,
  paymentMethodRejectedUserMessage,
  getEffectivePaymentMethodsForDropoff,
  normalizePaymentTypeForStorage,
} = require('../utils/storePaymentMethods');
const {
  computeCheckoutGrandTotalJod,
  resolveWalletCheckoutPlan,
  applyWalletDebitForOrder,
  getWalletBalance,
} = require('../wallet/checkoutWallet');
const { resolveStorePickupLocation } = require('../utils/mapsUrlResolve');
const { ensureOrderStatusTimestampColumns, recordOrderStatusTimestamp } = require('../utils/orderStatusTimestamps');
const {
  customerOwnsOrder,
  loadStoreOrdersForCustomer,
  loadArhebBoxForCustomer,
  isTerminalOrderStatus,
  isActiveOrderStatus,
} = require('../utils/customerOrders');
const { storeOrderMoneyFields } = require('../utils/orderMoney');

module.exports = function attachCheckoutRoutes(app, db, authenticateRequest) {
  const { getJsonPath } = require('../config/jsonPaths');
  ensurePlatformCheckoutFeesTable(db);
  ensureOrderStatusTimestampColumns(db);
  seedDefaultDeliveryFixedZonesIfEmpty(db);
  const FEES_TAX_RATE = 0;

  function fallbackStoreOrderServiceFeeJod() {
    try {
      return getPlatformCheckoutFeeTiers(db).defaultServiceFeeJod;
    } catch (e) {
      return STORE_ORDER_SERVICE_FEE_JOD;
    }
  }

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

  function buildInvoice(deliveryFeeJod, serviceFeeJod, itemsSubtotalJod = 0) {
    const taxJod = calcFeesTaxJod(deliveryFeeJod, serviceFeeJod);
    const delivery = round2(safeNumber(deliveryFeeJod, 0));
    const service = round2(safeNumber(serviceFeeJod, 0));
    const itemsSubtotal = round2(safeNumber(itemsSubtotalJod, 0));
    const feesTotal = round2(delivery + service + taxJod);
    return {
      currency: 'JOD',
      itemsSubtotal,
      deliveryFee: delivery,
      serviceFee: service,
      feesTaxRate: FEES_TAX_RATE,
      feesTax: taxJod,
      feesTotal,
      total: round2(itemsSubtotal + feesTotal),
    };
  }

  /** Customer-facing money: DB totalAmount is items subtotal; totalAmount in API is grand total. */
  function customerStoreOrderMoney(order, serviceFee, feesTax, options = {}) {
    return storeOrderMoneyFields({ ...order, serviceFee, feesTax }, options);
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
  try {
    db.exec(`ALTER TABLE order_items ADD COLUMN notes TEXT`);
  } catch (e) {
    /* exists */
  }
  try { db.exec(`ALTER TABLE orders ADD COLUMN walletAmountJod REAL DEFAULT 0`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN paymentCartId TEXT`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN einvoiceStatus TEXT`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN einvoiceQR TEXT`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN einvoiceUUID TEXT`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN einvoiceError TEXT`); } catch (e) { /* exists */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN einvoiceSubmittedAt TEXT`); } catch (e) { /* exists */ }

  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  
  // Promo code queries
  const findPromoCodeByName = db.prepare('SELECT * FROM promo_codes WHERE name = ?');
  const findPromoStoreIdsByPromoId = db.prepare('SELECT storeId FROM promo_code_stores WHERE promoCodeId = ?');

  function promoExtraStoreIdsForRow(promoRow) {
    if (!promoRow || promoRow.id == null) return null;
    const rows = findPromoStoreIdsByPromoId.all(promoRow.id);
    return rows.length ? rows.map((r) => String(r.storeId).trim()).filter(Boolean) : null;
  }
  
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
            paymentCartId,
            walletAmountJod,
            createdAt
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
            @paymentCartId,
            @walletAmountJod,
            @createdAt
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
      serviceFee: orderData.serviceFee != null ? orderData.serviceFee : fallbackStoreOrderServiceFeeJod(),
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
      walletAmountJod: orderData.walletAmountJod != null ? orderData.walletAmountJod : 0,
      createdAt: nowOrderCreatedAtForDb(),
    });

    const orderId = orderResult.lastInsertRowid;

    const insertOrderItem = db.prepare(`
          INSERT INTO order_items (
            orderId,
            productId,
            productName,
            price,
            quantity,
            selectedAddOns,
            notes
          ) VALUES (
            @orderId,
            @productId,
            @productName,
            @price,
            @quantity,
            @selectedAddOns,
            @notes
          )
        `);

    for (const item of orderData.items) {
      const addOnsObj = item._normalizedAddOns || {};
      const addOnsStr = Object.keys(addOnsObj).length ? JSON.stringify(addOnsObj) : null;
      const noteRaw = item.notes ?? item.note ?? item.itemNotes ?? null;
      const noteStr =
        noteRaw != null && String(noteRaw).trim() !== '' ? String(noteRaw).trim().slice(0, 2000) : null;
      insertOrderItem.run({
        orderId: orderId,
        productId: item.id,
        productName: item.name,
        price: item.price,
        quantity: item.quantity,
        selectedAddOns: addOnsStr,
        notes: noteStr,
      });
    }

    if (orderData.storeArhebFeePercent != null && Number.isFinite(Number(orderData.storeArhebFeePercent))) {
      try {
        db.prepare('UPDATE orders SET storeArhebFeePercent = ? WHERE id = ?').run(Number(orderData.storeArhebFeePercent), orderId);
      } catch (e) {
        /* ignore */
      }
    }
    try {
      recordOrderStatusTimestamp(db, orderId, orderData.status || 'Waiting confirmation');
    } catch (e) {
      /* ignore */
    }

    return orderId;
  });

  /**
   * Shared order creation (used by POST /api/checkout and POST /api/payment/initiate).
   * @param {string} userId - From JWT (userId or phone)
   * @param {object} body - Same shape as POST /api/checkout body
   * @param {{ forcePaymentType?: string, initialStatusOverride?: string }} options
   */
  async function createOrderFromCheckoutBody(userId, body, options = {}) {
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
      cartAmount,
      walletAmountJod,
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

    /** Prefer explicit cartAmount from client (items subtotal); else fall back to totalAmount for legacy clients. */
    const effectiveCartAmountForPromo = (() => {
      const c = Number(cartAmount);
      if (Number.isFinite(c) && c >= 0) return c;
      const t = Number(totalAmount);
      if (Number.isFinite(t) && t >= 0) return t;
      return null;
    })();

    if (promoCode) {
      const promoCodeRecord = findPromoCodeByName.get(promoCode.trim());
      if (!promoCodeRecord) {
        return { ok: false, statusCode: 400, message: 'invalid promoCode' };
      }
      if (!promoAppliesToStore(promoCodeRecord, finalStoreId, promoExtraStoreIdsForRow(promoCodeRecord))) {
        return { ok: false, statusCode: 400, message: 'promo code not available for this store' };
      }
      if (!promoMinAmountOk(promoCodeRecord, effectiveCartAmountForPromo)) {
        return {
          ok: false,
          statusCode: 400,
          message: `promo code requires cart amount >= ${promoCodeRecord.minOrderAmount} JOD`,
        };
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

    if (finalStoreId != null && String(finalStoreId).trim() !== '') {
      const storeCheck = loadStoreFromJsonById(finalStoreId);
      if (storeCheck) {
        if (storeCheck.blocked === true) {
          return { ok: false, statusCode: 400, message: 'This store is currently unavailable' };
        }
        if (storeCheck.paused === true) {
          return { ok: false, statusCode: 400, message: 'This store is currently paused and not accepting orders' };
        }
        if (storeCheck.isOpen === false) {
          return { ok: false, statusCode: 400, message: 'This store is currently closed' };
        }
        if (!isPaymentTypeAllowedForStore(storeCheck, lowerPaymentType, addressLat, addressLong)) {
          return {
            ok: false,
            statusCode: 400,
            message: paymentMethodRejectedUserMessage(lowerPaymentType, addressLat, addressLong),
          };
        }
      }
    }

    if (options.dryRun !== true && fcmToken != null && typeof fcmToken === 'string' && phoneNumber) {
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
    const platformTiers = getPlatformCheckoutFeeTiers(db);
    /** Non-store checkout (edge): legacy weight-only floor. Store orders use distance fee below. */
    let computedDeliveryFee = calcArhebBoxDeliveryFeeJod(weightKgNum);
    let storeJsonForFees = null;
    if (finalStoreId != null && String(finalStoreId).trim() !== '') {
      storeJsonForFees = loadStoreFromJsonById(finalStoreId);
      if (
        typeof addressLat === 'number' &&
        !Number.isNaN(addressLat) &&
        typeof addressLong === 'number' &&
        !Number.isNaN(addressLong)
      ) {
        const st = storeJsonForFees;
        if (st) {
          const storeLoc = await resolveStorePickupLocation(st);
          if (storeLoc) {
            const qOrder = quoteFromPickupDropoff(
              storeLoc,
              {
                latitude: addressLat,
                longitude: addressLong,
              },
              db,
            );
            if (qOrder) {
              computedDeliveryFee = storeOrderDeliveryFeeDistanceOnly(qOrder.distanceKm, platformTiers);
            } else {
              computedDeliveryFee = storeOrderDeliveryFeeDistanceOnly(0, platformTiers);
            }
          } else {
            computedDeliveryFee = storeOrderDeliveryFeeDistanceOnly(0, platformTiers);
          }
        } else {
          computedDeliveryFee = storeOrderDeliveryFeeDistanceOnly(0, platformTiers);
        }
      } else {
        computedDeliveryFee = storeOrderDeliveryFeeDistanceOnly(0, platformTiers);
      }
    }
    computedDeliveryFee = resolveStoreOrderDeliveryFeeJod(
      storeJsonForFees,
      computedDeliveryFee,
      addressLat,
      addressLong,
      { cartAmountJod: effectiveCartAmountForPromo, platformTiers, db },
    );
    const computedServiceFee = resolveStoreOrderServiceFeeJod(storeJsonForFees, platformTiers.defaultServiceFeeJod);
    const computedFeesTax = calcFeesTaxJod(computedDeliveryFee, computedServiceFee);
    /**
     * Charge base = items subtotal (after discount), NOT the client `totalAmount`.
     * The app sends `totalAmount` already including delivery/service, so using it as the
     * base double-counted the fees on card/wallet charges. Deriving the subtotal from the
     * items keeps the server authoritative on fees and matches both new and legacy clients
     * (legacy `totalAmount` == items subtotal, so the result is identical there).
     */
    const itemsSubtotalJod = round2(
      itemsCopy.reduce(
        (sum, it) => sum + safeNumber(it.price, 0) * safeNumber(it.quantity, 0),
        0,
      ),
    );
    const orderValueForChargeJod = Math.max(
      0,
      round2(itemsSubtotalJod - (safeNumber(finalDiscount, 0))),
    );
    const grandTotalJod = computeCheckoutGrandTotalJod(
      orderValueForChargeJod,
      computedDeliveryFee,
      computedServiceFee,
      computedFeesTax,
    );
    const walletBalanceJod = getWalletBalance(db, phoneNumber);
    const walletPlan = resolveWalletCheckoutPlan({
      paymentType: options.storedPaymentType || normalizedPaymentType,
      walletAmountJod,
      grandTotalJod,
      walletBalanceJod,
      storeJson: storeJsonForFees,
      addressLat,
      addressLong,
    });
    if (!walletPlan.ok) {
      return { ok: false, statusCode: walletPlan.statusCode || 400, message: walletPlan.message };
    }
    const finalWalletAmountJod = walletPlan.walletAmountJod || 0;
    const finalPaymentType =
      options.storedPaymentType ||
      walletPlan.paymentType ||
      normalizedPaymentType;
    const paymentTypeForStorage = normalizePaymentTypeForStorage(finalPaymentType);

    if (!options.initialStatusOverride) {
      const pt = String(finalPaymentType).toLowerCase();
      if (pt === 'wallet+cliq') initialStatus = 'Waiting cliq confirmation';
      else if (pt === 'wallet') initialStatus = 'Waiting confirmation';
    }

    if (
      finalWalletAmountJod > 0 &&
      walletPlan.remainderJod > 0 &&
      String(finalPaymentType).includes('card') &&
      options.forcePaymentType &&
      options.dryRun !== true
    ) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Wallet + Card orders must be created via POST /api/payment/initiate (card is charged for the remainder only).',
      };
    }

    if (options.dryRun === true) {
      return {
        ok: true,
        dryRun: true,
        preview: {
          userId,
          phoneNumber,
          name: name || null,
          totalAmount,
          deliveryFee: computedDeliveryFee,
          serviceFee: computedServiceFee,
          feesTax: computedFeesTax,
          grandTotalJod,
          walletAmountJod: finalWalletAmountJod,
          remainderJod: walletPlan.remainderJod || 0,
          walletBalanceJod,
          weightKg: round3(weightKgNum),
          status: initialStatus,
          paymentType: paymentTypeForStorage,
          storeId: finalStoreId,
          promoCode: finalPromoCode,
          discount: finalDiscount,
        },
      };
    }

    let orderId;
    try {
      const feeSnap =
        storeJsonForFees?.arhebFee != null && Number.isFinite(Number(storeJsonForFees.arhebFee))
          ? Number(storeJsonForFees.arhebFee)
          : null;
      const createAndMaybeDebit = db.transaction(() => {
        const oid = createOrder({
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
          totalAmount: orderValueForChargeJod,
          status: initialStatus,
          paymentType: paymentTypeForStorage,
          promoCode: finalPromoCode,
          storeId: finalStoreId,
          nearby: nearby || null,
          notes: notes || null,
          paymentVerificationImage: paymentVerificationImage || null,
          items: itemsCopy,
          storeArhebFeePercent: feeSnap,
          walletAmountJod: finalWalletAmountJod,
        });
        if (finalWalletAmountJod > 0 && options.skipWalletDebit !== true) {
          const debit = applyWalletDebitForOrder(db, {
            phoneNumber,
            userId,
            walletAmountJod: finalWalletAmountJod,
            orderId: oid,
          });
          if (!debit.ok) {
            const err = new Error(debit.message || 'Wallet debit failed');
            err.code = 'WALLET_DEBIT';
            throw err;
          }
        }
        return oid;
      });
      orderId = createAndMaybeDebit();
    } catch (e) {
      if (e.code === 'WALLET_DEBIT') {
        return { ok: false, statusCode: e.statusCode || 400, message: e.message };
      }
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

    try {
      const { emitAdminOrdersListUpdated } = require('../order/trackingEmitter');
      if (typeof emitAdminOrdersListUpdated === 'function') {
        emitAdminOrdersListUpdated({ kind: 'store_order', orderId, source: 'checkout' });
      }
    } catch (_) {
      /* ignore */
    }

    const order = findOrderById.get(orderId);
    const findOrderItemsCreated = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
    const itemsOut = mapOrderItemsRows(findOrderItemsCreated.all(orderId));
    const serviceFeeOut =
      order.serviceFee != null ? Number(order.serviceFee) : fallbackStoreOrderServiceFeeJod();
    const feesTaxOut =
      order.feesTax != null
        ? Number(order.feesTax)
        : calcFeesTaxJod(order.deliveryFee, serviceFeeOut);
    const money = customerStoreOrderMoney(order, serviceFeeOut, feesTaxOut, { items: itemsOut });

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
          deliveryFee: money.deliveryFee,
          serviceFee: money.serviceFee,
          feesTax: money.feesTax,
          weightKg: order.weightKg != null ? order.weightKg : round3(weightKgNum),
          itemsSubtotal: money.itemsSubtotal,
          totalAmount: money.totalAmount,
          orderSummary: buildOrderSummary(money.itemsSubtotal, money.deliveryFee, money.serviceFee),
          invoice: buildInvoice(money.deliveryFee, money.serviceFee, money.itemsSubtotal),
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
  app.post('/api/checkout/quote-fees', authenticateRequest, async (req, res) => {
    try {
      const { storeId, deliveryLocation, weightKg, cartAmount } = req.body || {};
      const cartAmountNum = (() => {
        const c = Number(cartAmount);
        return Number.isFinite(c) && c >= 0 ? c : null;
      })();
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
      const storeLocation = await resolveStorePickupLocation(store);
      if (!storeLocation) {
        return res.status(400).json({
          success: false,
          message: 'Store location is unavailable. Please set store mapsUrl with coordinates.',
        });
      }
      const q = quoteFromPickupDropoff(storeLocation, deliveryLocation, db);
      if (!q) {
        return res.status(400).json({
          success: false,
          message: 'deliveryLocation must include valid latitude and longitude',
        });
      }
      const weightKgNum = Math.max(0, safeNumber(weightKg, 0));
      const platformTiers = getPlatformCheckoutFeeTiers(db);
      const distanceFee = storeOrderDeliveryFeeDistanceOnly(q.distanceKm, platformTiers);
      const resolved = resolveStoreOrderDeliveryFeeJodDetailed(
        store,
        distanceFee,
        deliveryLocation.latitude,
        deliveryLocation.longitude,
        { cartAmountJod: cartAmountNum, platformTiers, db },
      );
      const deliveryFee = resolved.fee;
      const serviceFee = resolveStoreOrderServiceFeeJod(store, platformTiers.defaultServiceFeeJod);
      const invoice = buildInvoice(deliveryFee, serviceFee);
      const paymentMethods = getEffectivePaymentMethodsForDropoff(
        store,
        deliveryLocation.latitude,
        deliveryLocation.longitude,
      );
      return res.status(200).json({
        success: true,
        data: {
          storeId: String(storeId),
          storeName: store.name ?? null,
          storeLocation,
          distanceKm: q.distanceKm,
          deliveryFeeMaxJod: platformTiers.maxJod,
          weightKg: round3(weightKgNum),
          currency: 'JOD',
          deliveryFee: invoice.deliveryFee,
          deliveryFeeSource: resolved.source,
          serviceFee: invoice.serviceFee,
          feesTaxRate: FEES_TAX_RATE,
          feesTax: invoice.feesTax,
          feesTaxNote: FEES_TAX_RATE > 0
            ? `${Math.round(FEES_TAX_RATE * 100)}% tax on delivery fee plus service fee (not on order subtotal).`
            : 'Tax on delivery/service fees is currently disabled.',
          invoiceTotal: invoice.feesTotal,
          paymentMethods,
          paymentMethodsNote: !paymentMethods.cod && !paymentMethods.visaondelivery
            ? 'Cash / Visa on delivery is not available for this delivery area. Use Card or Cliq.'
            : null,
          pricingNote: (() => {
            const parts = [];
            const flat = platformTiers.flatDeliveryFeeJod;
            if (flat != null) {
              parts.push(
                `Platform fixed delivery ${flat} JOD for normal areas; special-far, uncapped, and remote zones use other rules.`,
              );
            } else {
              parts.push(
                `Store delivery fee: first km + per-km up to max (platform tiers; currently max ${platformTiers.maxJod} JOD).`,
              );
            }
            if (
              platformTiers.deliveryOverCartThresholdJod != null &&
              platformTiers.deliveryFeeAboveJod != null
            ) {
              parts.push(
                `When cart >= ${platformTiers.deliveryOverCartThresholdJod} JOD, delivery is ${platformTiers.deliveryFeeAboveJod} JOD (all stores).`,
              );
            }
            if (
              store &&
              store.checkoutDeliveryOverCartThresholdJod != null &&
              store.checkoutDeliveryFeeAboveJod != null
            ) {
              parts.push(
                `Store override: cart >= ${store.checkoutDeliveryOverCartThresholdJod} JOD → ${store.checkoutDeliveryFeeAboveJod} JOD delivery.`,
              );
            }
            parts.push('Per-store checkoutDeliveryFeeJod overrides when set. Weight does not change delivery fee.');
            return parts.join(' ');
          })(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Checkout quote-fees error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Create order
  app.post('/api/checkout', authenticateRequest, async (req, res) => {
    try {
      const userId = req.user.userId || req.user.phoneNumber;
      const result = await createOrderFromCheckoutBody(userId, req.body, {});
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
      const phone = req.user.phoneNumber || userId;

      const orders = loadStoreOrdersForCustomer(db, userId, phone);

      // Fetch items for each order
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      
      // All orders for this user, including every status (Waiting confirmation, Preparing, On the way, Delivered, Cancelled, etc.)
      const ordersWithItems = orders.map(order => {
        const items = findOrderItems.all(order.id);
        const serviceFee = order.serviceFee != null ? Number(order.serviceFee) : fallbackStoreOrderServiceFeeJod();
        const feesTax =
          order.feesTax != null ? Number(order.feesTax) : calcFeesTaxJod(order.deliveryFee, serviceFee);
        const money = customerStoreOrderMoney(order, serviceFee, feesTax, { items, db });
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
            deliveryFee: money.deliveryFee,
            serviceFee: money.serviceFee,
            feesTax: money.feesTax,
            weightKg: order.weightKg != null ? Number(order.weightKg) : 0,
            itemsSubtotal: money.itemsSubtotal,
            totalAmount: money.totalAmount,
            orderSummary: buildOrderSummary(money.itemsSubtotal, money.deliveryFee, money.serviceFee),
            invoice: buildInvoice(money.deliveryFee, money.serviceFee, money.itemsSubtotal),
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
        arhebBoxRequests = loadArhebBoxForCustomer(db, userId, phone).map((r) => enrichArhebBoxRow(r, db));
      } catch (e) {
        if (!e.message || !e.message.includes('no such table')) throw e;
      }

      const activeStoreOrders = ordersWithItems.filter((o) => isActiveOrderStatus(o.status));
      const orderHistoryStore = ordersWithItems.filter((o) => isTerminalOrderStatus(o.status));
      const activeArhebBox = arhebBoxRequests.filter((r) => isActiveOrderStatus(r.status));
      const orderHistoryArhebBox = arhebBoxRequests.filter((r) => isTerminalOrderStatus(r.status));

      const combinedOrders = [
        ...ordersWithItems.map((o) => ({ ...o, orderType: 'store' })),
        ...arhebBoxRequests.map((r) => ({ ...r, orderType: 'arheb_box' })),
      ].sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });
      const combinedActiveOrders = combinedOrders.filter((o) => isActiveOrderStatus(o.status));
      const combinedOrderHistory = combinedOrders.filter((o) => isTerminalOrderStatus(o.status));

      return res.status(200).json({
        success: true,
        message: 'Orders retrieved successfully',
        data: {
          orders: ordersWithItems,
          count: ordersWithItems.length,
          activeOrders: activeStoreOrders,
          activeCount: activeStoreOrders.length,
          orderHistory: orderHistoryStore,
          orderHistoryCount: orderHistoryStore.length,
          arhebBoxRequests,
          arhebBoxCount: arhebBoxRequests.length,
          activeArhebBoxRequests: activeArhebBox,
          orderHistoryArhebBox,
          combinedOrders,
          combinedCount: combinedOrders.length,
          combinedActiveOrders,
          combinedOrderHistory,
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
      const userId = req.user.userId || req.user.phoneNumber;
      const phone = req.user.phoneNumber || userId;

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
      if (!customerOwnsOrder(order, userId, phone)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Fetch order items
      const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');
      const items = findOrderItems.all(orderId);
      const serviceFee = order.serviceFee != null ? Number(order.serviceFee) : fallbackStoreOrderServiceFeeJod();
      const feesTax =
        order.feesTax != null
          ? Number(order.feesTax)
          : calcFeesTaxJod(order.deliveryFee, serviceFee);
      const money = customerStoreOrderMoney(order, serviceFee, feesTax, { items, db });

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
              deliveryFee: money.deliveryFee,
              serviceFee: money.serviceFee,
              feesTax: money.feesTax,
              weightKg: order.weightKg != null ? Number(order.weightKg) : 0,
              itemsSubtotal: money.itemsSubtotal,
              totalAmount: money.totalAmount,
              orderSummary: buildOrderSummary(money.itemsSubtotal, money.deliveryFee, money.serviceFee),
              invoice: buildInvoice(money.deliveryFee, money.serviceFee, money.itemsSubtotal),
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
      const userId = req.user.userId || req.user.phoneNumber;
      const phone = req.user.phoneNumber || userId;
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
      if (!customerOwnsOrder(order, userId, phone)) {
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
      const serviceFee = updatedOrder.serviceFee != null ? Number(updatedOrder.serviceFee) : fallbackStoreOrderServiceFeeJod();
      const feesTax =
        updatedOrder.feesTax != null
          ? Number(updatedOrder.feesTax)
          : calcFeesTaxJod(updatedOrder.deliveryFee, serviceFee);
      const money = customerStoreOrderMoney(updatedOrder, serviceFee, feesTax, { items, db });

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
            deliveryFee: money.deliveryFee,
            serviceFee: money.serviceFee,
            feesTax: money.feesTax,
            weightKg: updatedOrder.weightKg != null ? Number(updatedOrder.weightKg) : 0,
            itemsSubtotal: money.itemsSubtotal,
            totalAmount: money.totalAmount,
            orderSummary: buildOrderSummary(money.itemsSubtotal, money.deliveryFee, money.serviceFee),
            invoice: buildInvoice(money.deliveryFee, money.serviceFee, money.itemsSubtotal),
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

  // Validate/Check promo code (optional query: storeId — must match when code is store-specific; cartAmount — enforced if promo has minOrderAmount)
  app.get('/api/promo-codes/:code', (req, res) => {
    try {
      const code = req.params.code;
      const storeIdQ =
        req.query.storeId != null && String(req.query.storeId).trim() !== ''
          ? String(req.query.storeId).trim()
          : null;
      const cartAmountRaw =
        req.query.cartAmount != null && String(req.query.cartAmount).trim() !== ''
          ? Number(req.query.cartAmount)
          : null;
      const cartAmountQ = Number.isFinite(cartAmountRaw) ? cartAmountRaw : null;

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

      const promoStoreIds = promoExtraStoreIdsForRow(promoCodeRecord);
      if (storeIdQ != null && !promoAppliesToStore(promoCodeRecord, storeIdQ, promoStoreIds)) {
        return res.status(404).json({
          success: false,
          message: 'promo code not available for this store'
        });
      }
      if (promoCodeRecord.minOrderAmount != null && !promoMinAmountOk(promoCodeRecord, cartAmountQ)) {
        return res.status(400).json({
          success: false,
          message: `promo code requires cart amount >= ${promoCodeRecord.minOrderAmount} JOD`,
          data: { minOrderAmount: Number(promoCodeRecord.minOrderAmount) },
        });
      }

      const restrictedList =
        promoStoreIds && promoStoreIds.length
          ? promoStoreIds
          : promoCodeRecord.storeId != null && String(promoCodeRecord.storeId).trim() !== ''
            ? [String(promoCodeRecord.storeId).trim()]
            : [];
      const data = {
        value: promoCodeRecord.value,
        name: promoCodeRecord.name,
        appliesToAllStores: restrictedList.length === 0,
        minOrderAmount:
          promoCodeRecord.minOrderAmount != null && String(promoCodeRecord.minOrderAmount).trim() !== ''
            ? Number(promoCodeRecord.minOrderAmount)
            : null,
      };
      if (restrictedList.length === 1) {
        data.storeId = restrictedList[0];
      } else if (restrictedList.length > 1) {
        data.storeIds = restrictedList;
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
