const fcm = require('../fcm');
const { quoteFromPickupDropoff, minAmountJod, distanceKm: haversineKm } = require('./pricing');

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

// Weight-only floor (used when distance is unknown)
function calcArhebBoxDeliveryFeeJod(weightKg) {
  const w = Math.max(0, safeNumber(weightKg, 0));
  const fee = 1 + 0.15 * w;
  return round2(Math.min(MAX_DELIVERY_FEE_JOD, fee));
}

const MAX_DELIVERY_FEE_JOD = 3;

/** Route minimum (1 JOD/km, min 2 JOD) + 0.15 JOD/kg — same basis as Arheb Box quote. Capped at 3 JOD. */
function calcDeliveryFeeFromDistanceAndWeight(distanceKm, weightKg) {
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const w = Math.max(0, safeNumber(weightKg, 0));
  return round2(Math.min(MAX_DELIVERY_FEE_JOD, minAmountJod(d) + 0.15 * w));
}

function calcFeesTaxJod(deliveryFeeJod, serviceFeeJod) {
  return round2(FEES_TAX_RATE * (safeNumber(deliveryFeeJod, 0) + safeNumber(serviceFeeJod, 0)));
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
  const feesTax = row.feesTax != null ? Number(row.feesTax) : calcFeesTaxJod(deliveryFee, serviceFee);
  return {
    id: row.id,
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
    createdAt: row.createdAt,
  };
}

module.exports = function attachArhebBoxRoutes(app, db, authenticateRequest) {
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
      serviceFee REAL DEFAULT 0.65,
      feesTax REAL DEFAULT 0,
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
    'ALTER TABLE arheb_box_requests ADD COLUMN serviceFee REAL DEFAULT 0.65',
    'ALTER TABLE arheb_box_requests ADD COLUMN feesTax REAL DEFAULT 0',
    'ALTER TABLE arheb_box_requests ADD COLUMN distanceKm REAL',
    'ALTER TABLE arheb_box_requests ADD COLUMN minAmountJod REAL',
  ];
  for (const sql of alters) {
    try {
      db.exec(sql);
    } catch (e) { /* exists */ }
  }

  const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
  const insertRequest = db.prepare(`
    INSERT INTO arheb_box_requests (
      phoneNumber, userName, pickup, dropoff, notes, status, fcmToken,
      receiverPhone, receiverName, paymentMethod, whoPays, amount,
      weightKg, deliveryFee, serviceFee, feesTax,
      distanceKm, minAmountJod
    )
    VALUES (
      @phoneNumber, @userName, @pickup, @dropoff, @notes, @status, @fcmToken,
      @receiverPhone, @receiverName, @paymentMethod, @whoPays, @amount,
      @weightKg, @deliveryFee, @serviceFee, @feesTax,
      @distanceKm, @minAmountJod
    )
  `);

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
          pricingNote: '1 JOD per km; minimum 2 JOD. Amount offered must be at least minAmountJod.',
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
      const user = findUserByPhone.get(phoneNumber);
      const userName = user?.name || null;

      const {
        pickup,
        dropoff,
        notes,
        fcmToken,
        receiverPhone,
        receiverName,
        paymentMethod,
        whoPays,
        amount,
        weightKg,
      } = req.body || {};
      const fcmTokenStr = typeof fcmToken === 'string' ? fcmToken.trim() || null : null;
      if (fcmTokenStr) {
        try {
          db.prepare('UPDATE users SET fcmToken = ? WHERE phoneNumber = ?').run(fcmTokenStr, phoneNumber);
        } catch (e) { /* ignore */ }
      }

      if (!pickup || typeof pickup !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'pickup is required and must be an object with latitude, longitude, address',
        });
      }
      if (typeof pickup.latitude !== 'number' || isNaN(pickup.latitude)) {
        return res.status(400).json({ success: false, message: 'pickup.latitude must be a valid number' });
      }
      if (typeof pickup.longitude !== 'number' || isNaN(pickup.longitude)) {
        return res.status(400).json({ success: false, message: 'pickup.longitude must be a valid number' });
      }

      if (!dropoff || typeof dropoff !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'dropoff is required and must be an object with latitude, longitude, address',
        });
      }
      if (typeof dropoff.latitude !== 'number' || isNaN(dropoff.latitude)) {
        return res.status(400).json({ success: false, message: 'dropoff.latitude must be a valid number' });
      }
      if (typeof dropoff.longitude !== 'number' || isNaN(dropoff.longitude)) {
        return res.status(400).json({ success: false, message: 'dropoff.longitude must be a valid number' });
      }

      const recvPhoneStr = receiverPhone != null ? String(receiverPhone).trim() : '';
      const recvNameStr = receiverName != null ? String(receiverName).trim() : '';
      if (!recvPhoneStr) {
        return res.status(400).json({ success: false, message: 'receiverPhone is required' });
      }
      if (!recvNameStr) {
        return res.status(400).json({ success: false, message: 'receiverName is required' });
      }

      const payMethod = paymentMethod != null ? String(paymentMethod).trim() : '';
      if (!payMethod) {
        return res.status(400).json({ success: false, message: 'paymentMethod is required (e.g. cash, Cliq, card)' });
      }
      const who = whoPays != null ? String(whoPays).trim().toLowerCase() : '';
      if (who !== 'sender' && who !== 'receiver') {
        return res.status(400).json({
          success: false,
          message: 'whoPays is required and must be "sender" or "receiver"',
        });
      }

      const quote = quoteFromPickupDropoff(pickup, dropoff);
      if (!quote) {
        return res.status(400).json({ success: false, message: 'Could not compute route distance' });
      }
      const dKm = haversineKm(pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude);
      const minJod = minAmountJod(dKm);
      const amountNum = amount != null ? Number(amount) : NaN;
      if (Number.isNaN(amountNum) || amountNum < minJod) {
        return res.status(400).json({
          success: false,
          message: `amount must be at least ${minJod} JOD for this distance (${quote.distanceKm} km). Call POST /api/arheb-box/quote first.`,
          data: { minAmountJod: minJod, distanceKm: quote.distanceKm },
        });
      }

      const pickupJson = JSON.stringify({
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        address: pickup.address != null ? String(pickup.address) : '',
      });
      const dropoffJson = JSON.stringify({
        latitude: dropoff.latitude,
        longitude: dropoff.longitude,
        address: dropoff.address != null ? String(dropoff.address) : '',
      });
      const notesStr = notes != null ? String(notes) : '';

      const weightKgNum = Math.max(0, safeNumber(weightKg, 0));
      const computedDeliveryFee = calcDeliveryFeeFromDistanceAndWeight(quote.distanceKm, weightKgNum);
      const computedServiceFee = SERVICE_FEE_JOD;
      const computedFeesTax = calcFeesTaxJod(computedDeliveryFee, computedServiceFee);

      const result = insertRequest.run({
        phoneNumber,
        userName,
        pickup: pickupJson,
        dropoff: dropoffJson,
        notes: notesStr,
        status: 'pending',
        fcmToken: fcmTokenStr,
        receiverPhone: recvPhoneStr,
        receiverName: recvNameStr,
        paymentMethod: payMethod,
        whoPays: who,
        amount: amountNum,
        weightKg: round3(weightKgNum),
        deliveryFee: computedDeliveryFee,
        serviceFee: computedServiceFee,
        feesTax: computedFeesTax,
        distanceKm: quote.distanceKm,
        minAmountJod: minJod,
      });

      const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(result.lastInsertRowid);

      return res.status(201).json({
        success: true,
        message: 'Arheb box request received successfully',
        data: {
          request: enrichRequestRow(row, null),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Arheb box error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  });
};

module.exports.enrichArhebBoxRow = enrichRequestRow;
module.exports.calcArhebBoxDeliveryFeeJod = calcArhebBoxDeliveryFeeJod;
module.exports.calcDeliveryFeeFromDistanceAndWeight = calcDeliveryFeeFromDistanceAndWeight;
module.exports.MAX_DELIVERY_FEE_JOD = MAX_DELIVERY_FEE_JOD;
