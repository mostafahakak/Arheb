const fcm = require('../fcm');
const { enrichWithJordanTime } = require('../utils/jordanTime');
const { arhebBoxDeliveryFeeFromDistanceJod, STORE_MAX_JOD } = require('../utils/deliveryFees');
const { quoteFromPickupDropoff, minAmountJod, distanceKm: haversineKm } = require('./pricing');

const SERVICE_FEE_JOD = 0;
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

/** When distance is unknown, use 1 JOD base (no weight-based add-on in current pricing). */
function calcArhebBoxDeliveryFeeJod(_weightKg) {
  return round2(1);
}

/** Arheb Box: 1 JOD first km + 0.5 JOD per additional km; no maximum. Distance-only; weight ignored. */
function calcDeliveryFeeFromDistanceAndWeight(distanceKm, _weightKg) {
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : null;
  if (d == null) return round2(1);
  return arhebBoxDeliveryFeeFromDistanceJod(d);
}

function calcFeesTaxJod(deliveryFeeJod) {
  return round2(FEES_TAX_RATE * safeNumber(deliveryFeeJod, 0));
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

function buildMapsUrl(loc) {
  if (!loc) return null;
  if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
    return `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
  }
  if (loc.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`;
  }
  return null;
}

function enrichRequestRow(row, db) {
  const pickupObj = (() => { try { return JSON.parse(row.pickup); } catch (e) { return {}; } })();
  const dropoffObj = (() => { try { return JSON.parse(row.dropoff); } catch (e) { return {}; } })();
  let driverPhone = null;
  if (row.driverId && db) {
    try {
      const d = db.prepare('SELECT mobile FROM drivers WHERE id = ?').get(row.driverId);
      driverPhone = d?.mobile ?? null;
    } catch (e) { /* ignore */ }
  }
  const weightKg = row.weightKg != null ? Number(row.weightKg) : 0;
  const dKm = row.distanceKm != null ? Number(row.distanceKm) : null;
  const deliveryFee =
    row.deliveryFee != null
      ? Number(row.deliveryFee)
      : dKm != null && Number.isFinite(dKm)
        ? calcDeliveryFeeFromDistanceAndWeight(dKm, weightKg)
        : calcArhebBoxDeliveryFeeJod(weightKg);
  const serviceFee = row.serviceFee != null ? Number(row.serviceFee) : SERVICE_FEE_JOD;
  const feesTax = row.feesTax != null ? Number(row.feesTax) : calcFeesTaxJod(deliveryFee);
  const base = {
    id: row.id,
    phoneNumber: row.phoneNumber ?? null,
    userName: row.userName ?? null,
    senderPhone: row.phoneNumber,
    senderName: row.userName,
    receiverPhone: row.receiverPhone || null,
    receiverName: row.receiverName || null,
    pickup: { ...pickupObj, mapsUrl: buildMapsUrl(pickupObj) },
    dropoff: { ...dropoffObj, mapsUrl: buildMapsUrl(dropoffObj) },
    notes: row.notes,
    status: row.status,
    paymentMethod: row.paymentMethod || null,
    whoPays: row.whoPays || null,
    amount: row.amount != null ? Number(row.amount) : null,
    weightKg,
    deliveryFee,
    serviceFee,
    feesTax,
    invoice: buildInvoice(deliveryFee, serviceFee),
    distanceKm: row.distanceKm != null ? Number(row.distanceKm) : null,
    minAmountJod: row.minAmountJod != null ? Number(row.minAmountJod) : null,
    driverId: row.driverId ?? null,
    driverName: row.driverName ?? null,
    driverPhone,
    einvoiceStatus: row.einvoiceStatus || null,
    einvoiceQR: row.einvoiceQR || null,
    einvoiceUUID: row.einvoiceUUID || null,
    einvoiceError: row.einvoiceError || null,
    einvoiceSubmittedAt: row.einvoiceSubmittedAt || null,
    createdAt: row.createdAt,
  };
  return enrichWithJordanTime(base, ['createdAt']);
}

function ensureArhebBoxTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS arheb_box_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phoneNumber TEXT NOT NULL,
      userName TEXT,
      pickup TEXT NOT NULL,
      dropoff TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      fcmToken TEXT,
      driverId INTEGER,
      driverName TEXT,
      receiverPhone TEXT,
      receiverName TEXT,
      paymentMethod TEXT,
      whoPays TEXT,
      amount REAL,
      weightKg REAL DEFAULT 0,
      deliveryFee REAL DEFAULT 0,
      serviceFee REAL DEFAULT 0,
      feesTax REAL DEFAULT 0,
      einvoiceStatus TEXT,
      einvoiceQR TEXT,
      einvoiceUUID TEXT,
      einvoiceError TEXT,
      einvoiceSubmittedAt TEXT,
      distanceKm REAL,
      minAmountJod REAL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const alters = [
    'ALTER TABLE arheb_box_requests ADD COLUMN fcmToken TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN driverId INTEGER',
    'ALTER TABLE arheb_box_requests ADD COLUMN driverName TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN receiverPhone TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN receiverName TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN paymentMethod TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN whoPays TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN amount REAL',
    'ALTER TABLE arheb_box_requests ADD COLUMN weightKg REAL DEFAULT 0',
    'ALTER TABLE arheb_box_requests ADD COLUMN deliveryFee REAL DEFAULT 0',
    'ALTER TABLE arheb_box_requests ADD COLUMN serviceFee REAL DEFAULT 0',
    'ALTER TABLE arheb_box_requests ADD COLUMN feesTax REAL DEFAULT 0',
    'ALTER TABLE arheb_box_requests ADD COLUMN einvoiceStatus TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN einvoiceQR TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN einvoiceUUID TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN einvoiceError TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN einvoiceSubmittedAt TEXT',
    'ALTER TABLE arheb_box_requests ADD COLUMN distanceKm REAL',
    'ALTER TABLE arheb_box_requests ADD COLUMN minAmountJod REAL',
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch (e) { /* exists */ }
  }
}

/**
 * Reusable: validate + insert an Arheb Box request. Used by POST /api/arheb-box and the card
 * payment module (POST /api/payment/arheb-box/initiate).
 * @returns {{ ok: boolean, statusCode?: number, message?: string, requestId?: number, row?: object }}
 */
function createArhebBoxRequest(db, phoneNumber, body, statusOverride, options = {}) {
  let opts = options || {};
  let desiredStatus = statusOverride;
  if (typeof statusOverride === 'object' && statusOverride !== null) {
    opts = statusOverride;
    desiredStatus = undefined;
  }
  const user = db.prepare('SELECT * FROM users WHERE phoneNumber = ?').get(phoneNumber);
  const userName = user?.name || null;

  const {
    pickup, dropoff, notes, fcmToken,
    receiverPhone, receiverName, paymentMethod, whoPays, amount, weightKg,
  } = body || {};
  const fcmTokenStr = typeof fcmToken === 'string' ? fcmToken.trim() || null : null;
  if (fcmTokenStr && opts.dryRun !== true) {
    try { db.prepare('UPDATE users SET fcmToken = ? WHERE phoneNumber = ?').run(fcmTokenStr, phoneNumber); } catch (e) { /* ignore */ }
  }

  if (!pickup || typeof pickup !== 'object') return { ok: false, statusCode: 400, message: 'pickup is required and must be an object with latitude, longitude, address' };
  if (typeof pickup.latitude !== 'number' || isNaN(pickup.latitude)) return { ok: false, statusCode: 400, message: 'pickup.latitude must be a valid number' };
  if (typeof pickup.longitude !== 'number' || isNaN(pickup.longitude)) return { ok: false, statusCode: 400, message: 'pickup.longitude must be a valid number' };
  if (!dropoff || typeof dropoff !== 'object') return { ok: false, statusCode: 400, message: 'dropoff is required and must be an object with latitude, longitude, address' };
  if (typeof dropoff.latitude !== 'number' || isNaN(dropoff.latitude)) return { ok: false, statusCode: 400, message: 'dropoff.latitude must be a valid number' };
  if (typeof dropoff.longitude !== 'number' || isNaN(dropoff.longitude)) return { ok: false, statusCode: 400, message: 'dropoff.longitude must be a valid number' };

  const recvPhoneStr = receiverPhone != null ? String(receiverPhone).trim() : '';
  const recvNameStr = receiverName != null ? String(receiverName).trim() : '';
  if (!recvPhoneStr) return { ok: false, statusCode: 400, message: 'receiverPhone is required' };
  if (!recvNameStr) return { ok: false, statusCode: 400, message: 'receiverName is required' };

  const payMethod = paymentMethod != null ? String(paymentMethod).trim() : '';
  if (!payMethod) return { ok: false, statusCode: 400, message: 'paymentMethod is required (e.g. cash, Cliq, card)' };
  const who = whoPays != null ? String(whoPays).trim().toLowerCase() : '';
  if (who !== 'sender' && who !== 'receiver') return { ok: false, statusCode: 400, message: 'whoPays is required and must be "sender" or "receiver"' };

  const quote = quoteFromPickupDropoff(pickup, dropoff);
  if (!quote) return { ok: false, statusCode: 400, message: 'Could not compute route distance' };
  const dKm = haversineKm(pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude);
  const minJod = minAmountJod(dKm);
  const amountNum = amount != null ? Number(amount) : NaN;
  if (Number.isNaN(amountNum) || amountNum < minJod) {
    return { ok: false, statusCode: 400, message: `amount must be at least ${minJod} JOD for this distance (${quote.distanceKm} km). Call POST /api/arheb-box/quote first.`, data: { minAmountJod: minJod, distanceKm: quote.distanceKm } };
  }

  const pickupJson = JSON.stringify({ latitude: pickup.latitude, longitude: pickup.longitude, address: pickup.address != null ? String(pickup.address) : '' });
  const dropoffJson = JSON.stringify({ latitude: dropoff.latitude, longitude: dropoff.longitude, address: dropoff.address != null ? String(dropoff.address) : '' });
  const notesStr = notes != null ? String(notes) : '';
  const weightKgNum = Math.max(0, safeNumber(weightKg, 0));
  const computedDeliveryFee = calcDeliveryFeeFromDistanceAndWeight(quote.distanceKm, weightKgNum);
  const computedServiceFee = SERVICE_FEE_JOD;
  const computedFeesTax = calcFeesTaxJod(computedDeliveryFee);

  const insertPayload = {
    phoneNumber, userName,
    pickup: pickupJson, dropoff: dropoffJson,
    notes: notesStr, status: desiredStatus || 'pending',
    fcmToken: fcmTokenStr,
    receiverPhone: recvPhoneStr, receiverName: recvNameStr,
    paymentMethod: payMethod, whoPays: who,
    amount: amountNum, weightKg: round3(weightKgNum),
    deliveryFee: computedDeliveryFee, serviceFee: computedServiceFee,
    feesTax: computedFeesTax, distanceKm: quote.distanceKm, minAmountJod: minJod,
  };

  if (opts.dryRun === true) {
    return {
      ok: true,
      row: {
        ...insertPayload,
        id: null,
        pickup: pickupJson,
        dropoff: dropoffJson,
      },
      preview: {
        deliveryFee: computedDeliveryFee,
        serviceFee: computedServiceFee,
        feesTax: computedFeesTax,
        total: buildInvoice(computedDeliveryFee, computedServiceFee).total,
      },
    };
  }

  const insertRequest = db.prepare(`
    INSERT INTO arheb_box_requests (
      phoneNumber, userName, pickup, dropoff, notes, status, fcmToken,
      receiverPhone, receiverName, paymentMethod, whoPays, amount,
      weightKg, deliveryFee, serviceFee, feesTax,
      distanceKm, minAmountJod
    ) VALUES (
      @phoneNumber, @userName, @pickup, @dropoff, @notes, @status, @fcmToken,
      @receiverPhone, @receiverName, @paymentMethod, @whoPays, @amount,
      @weightKg, @deliveryFee, @serviceFee, @feesTax,
      @distanceKm, @minAmountJod
    )
  `);

  const result = insertRequest.run(insertPayload);

  const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(result.lastInsertRowid);
  return { ok: true, requestId: row.id, row };
}

module.exports = function attachArhebBoxRoutes(app, db, authenticateRequest) {
  ensureArhebBoxTable(db);

  // Quote: distance + minimum JOD (no auth)
  app.post('/api/arheb-box/quote', (req, res) => {
    try {
      const { pickup, dropoff } = req.body || {};
      if (!pickup || !dropoff) {
        return res.status(400).json({ success: false, message: 'pickup and dropoff are required' });
      }
      const q = quoteFromPickupDropoff(pickup, dropoff);
      if (!q) {
        return res.status(400).json({
          success: false,
          message: 'pickup and dropoff must include valid latitude and longitude',
        });
      }
      return res.status(200).json({
        success: true,
        data: {
          distanceKm: q.distanceKm,
          minAmountJod: q.minAmountJod,
          currency: 'JOD',
          pricingNote:
            'Arheb Box delivery fee: 1 JOD for the first km + 0.5 JOD per additional km (no cap). Amount offered must be at least minAmountJod.',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Arheb box quote error:', e);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/arheb-box/:id', authenticateRequest, (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ success: false, message: 'Request not found' });
      if (row.phoneNumber !== req.user.phoneNumber) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      return res.status(200).json({
        success: true,
        data: { request: enrichRequestRow(row, db) },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Arheb box get error:', e);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/arheb-box', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const result = createArhebBoxRequest(db, phoneNumber, req.body);
      if (!result.ok) {
        return res.status(result.statusCode || 400).json({
          success: false,
          message: result.message,
          ...(result.data ? { data: result.data } : {}),
        });
      }
      return res.status(201).json({
        success: true,
        message: 'Arheb box request received successfully',
        data: { request: enrichRequestRow(result.row, null) },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Arheb box error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
};

module.exports.enrichArhebBoxRow = enrichRequestRow;
module.exports.createArhebBoxRequest = createArhebBoxRequest;
module.exports.ensureArhebBoxTable = ensureArhebBoxTable;
module.exports.calcArhebBoxDeliveryFeeJod = calcArhebBoxDeliveryFeeJod;
module.exports.calcDeliveryFeeFromDistanceAndWeight = calcDeliveryFeeFromDistanceAndWeight;
/** @deprecated Store-order max (3 JOD). Arheb Box delivery fee has no cap. */
module.exports.MAX_DELIVERY_FEE_JOD = STORE_MAX_JOD;
