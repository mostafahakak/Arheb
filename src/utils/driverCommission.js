/**
 * Global driver commission (admin-configurable) and per-order snapshot on assign.
 */

const MAX_DELIVERY_FEE_JOD = 3;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function ensureDriverCommissionSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_commission_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      commissionType TEXT NOT NULL DEFAULT 'percent',
      commissionValue REAL NOT NULL DEFAULT 0.65,
      updatedAt TEXT
    )
  `);
  db.prepare(
    `INSERT OR IGNORE INTO driver_commission_settings (id, commissionType, commissionValue, updatedAt) VALUES (1, 'percent', 0.65, datetime('now'))`
  ).run();
}

function ensureOrderDriverShareColumns(db) {
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverCommissionType TEXT`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverCommissionValue REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverEarnings REAL`);
  } catch (e) {
    /* exists */
  }
}

function ensureArhebBoxDriverShareColumns(db) {
  try {
    db.exec(`ALTER TABLE arheb_box_requests ADD COLUMN driverCommissionType TEXT`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE arheb_box_requests ADD COLUMN driverCommissionValue REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE arheb_box_requests ADD COLUMN driverEarnings REAL`);
  } catch (e) {
    /* exists */
  }
}

function ensureDriverRatingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL UNIQUE,
      userId TEXT NOT NULL,
      driverId INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      notes TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec(`ALTER TABLE drivers ADD COLUMN ratingCount INTEGER DEFAULT 0`);
  } catch (e) {
    /* exists */
  }
}

/** Per-driver commission rate (share of delivery fee), 0–1 e.g. 0.65 = 65%. */
function ensureDriverCommissionPercentColumn(db) {
  try {
    db.exec(`ALTER TABLE drivers ADD COLUMN commissionPercent REAL`);
  } catch (e) {
    /* exists */
  }
}

/** App info (`contact_us.driverDeliveryPercent`): default % when driver.commissionPercent is unset. */
function ensureContactUsDriverDeliveryPercentColumn(db) {
  try {
    db.exec(`ALTER TABLE contact_us ADD COLUMN driverDeliveryPercent REAL`);
  } catch (e) {
    /* exists */
  }
}

/** App info: show Arheb Box as “coming soon” in GET /api/contact (also set via PATCH /api/admin/info). */
function ensureContactUsArhebBoxComingSoonColumn(db) {
  try {
    db.exec(`ALTER TABLE contact_us ADD COLUMN arhebBoxComingSoon INTEGER DEFAULT 0`);
  } catch (e) {
    /* exists */
  }
}

/**
 * Default driver share of delivery fee (0–1) when `drivers.commissionPercent` is NULL:
 * use **App info** (`contact_us.driverDeliveryPercent`); if unset, fall back to global commission settings (percent mode) or 0.65.
 */
function getDriverDeliveryDefaultPercent(db) {
  ensureDriverCommissionSettingsTable(db);
  ensureContactUsDriverDeliveryPercentColumn(db);
  const global = getDriverCommissionSettings(db);
  const fallbackFromGlobal = global.type === 'percent' ? global.value : 0.65;
  try {
    const row = db.prepare('SELECT driverDeliveryPercent FROM contact_us ORDER BY id DESC LIMIT 1').get();
    if (row && row.driverDeliveryPercent != null && String(row.driverDeliveryPercent).trim() !== '') {
      return normalizeDriverCommissionPercent(Number(row.driverDeliveryPercent), fallbackFromGlobal);
    }
  } catch (e) {
    /* no contact_us */
  }
  return fallbackFromGlobal;
}

/**
 * @param {unknown} raw - 0–1 or 0–100, or null/empty to mean "use global default at assign time"
 * @param {number} fallback - normalized 0–1 from global settings
 */
function normalizeDriverCommissionPercent(raw, fallback) {
  const fb = typeof fallback === 'number' && Number.isFinite(fallback) ? Math.min(1, Math.max(0, fallback)) : 0.65;
  if (raw == null || raw === '') return fb;
  let v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return fb;
  if (v > 1 && v <= 100) v = v / 100;
  if (v > 1) v = 1;
  return v;
}

/**
 * Validates admin/API input for storing on the driver row (null allowed = clear, use global at runtime).
 * @throws {Error} code VALIDATION
 */
function parseDriverCommissionPercentForStorage(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  let v = Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    const err = new Error('commissionPercent must be null or a non-negative number (0–1 or 0–100)');
    err.code = 'VALIDATION';
    throw err;
  }
  if (v > 1 && v <= 100) v = v / 100;
  if (v > 1) v = 1;
  return v;
}

function getDriverCommissionSettings(db) {
  ensureDriverCommissionSettingsTable(db);
  const row = db.prepare('SELECT commissionType, commissionValue FROM driver_commission_settings WHERE id = 1').get();
  const type = row?.commissionType === 'fixed' ? 'fixed' : 'percent';
  let value = row?.commissionValue != null ? Number(row.commissionValue) : type === 'percent' ? 0.65 : 0.2;
  if (!Number.isFinite(value) || value < 0) {
    value = type === 'percent' ? 0.65 : 0.2;
  }
  if (type === 'percent' && value > 1) {
    value = Math.min(1, value / 100);
  }
  return { type, value };
}

function setDriverCommissionSettings(db, type, rawValue) {
  ensureDriverCommissionSettingsTable(db);
  if (type !== 'fixed' && type !== 'percent') {
    const err = new Error('commissionType must be "fixed" or "percent"');
    err.code = 'VALIDATION';
    throw err;
  }
  let value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    const err = new Error('commissionValue must be a non-negative number');
    err.code = 'VALIDATION';
    throw err;
  }
  if (type === 'percent') {
    if (value > 1 && value <= 100) value = value / 100;
    if (value > 1 || value < 0) {
      const err = new Error('For percent, use 0–1 (e.g. 0.65) or 0–100 (e.g. 65)');
      err.code = 'VALIDATION';
      throw err;
    }
  }
  db.prepare(
    `UPDATE driver_commission_settings SET commissionType = ?, commissionValue = ?, updatedAt = datetime('now') WHERE id = 1`
  ).run(type, value);
  return getDriverCommissionSettings(db);
}

function computeDriverEarningsJod(deliveryFee, type, value) {
  const fee = Math.max(0, Number(deliveryFee) || 0);
  if (type === 'fixed') {
    const v = Math.max(0, Number(value) || 0);
    return round2(Math.min(v, fee));
  }
  const p = Math.min(1, Math.max(0, Number(value) || 0));
  return round2(fee * p);
}

function resolveOrderDriverShare(db, order) {
  if (
    order &&
    order.driverCommissionType != null &&
    order.driverCommissionValue != null &&
    order.driverEarnings != null
  ) {
    return {
      commissionType: order.driverCommissionType,
      commissionValue: round2(Number(order.driverCommissionValue)),
      earningsJod: round2(Number(order.driverEarnings)),
    };
  }
  const global = getDriverCommissionSettings(db);
  const defaultPct = getDriverDeliveryDefaultPercent(db);
  if (order && order.driverId != null) {
    ensureDriverCommissionPercentColumn(db);
    let row;
    try {
      row = db.prepare('SELECT commissionPercent FROM drivers WHERE id = ?').get(order.driverId);
    } catch (e) {
      row = null;
    }
    const pct = normalizeDriverCommissionPercent(row?.commissionPercent, defaultPct);
    return {
      commissionType: 'percent',
      commissionValue: round2(pct),
      earningsJod: computeDriverEarningsJod(order?.deliveryFee, 'percent', pct),
    };
  }
  return {
    commissionType: global.type,
    commissionValue: global.value,
    earningsJod: computeDriverEarningsJod(order?.deliveryFee, global.type, global.value),
  };
}

/** Arheb Box row: same commission model as store orders (share of deliveryFee). */
function resolveArhebBoxDriverShare(db, box) {
  if (
    box &&
    box.driverCommissionType != null &&
    box.driverCommissionValue != null &&
    box.driverEarnings != null
  ) {
    return {
      commissionType: box.driverCommissionType,
      commissionValue: round2(Number(box.driverCommissionValue)),
      earningsJod: round2(Number(box.driverEarnings)),
    };
  }
  const global = getDriverCommissionSettings(db);
  const defaultPct = getDriverDeliveryDefaultPercent(db);
  if (box && box.driverId != null) {
    ensureDriverCommissionPercentColumn(db);
    let row;
    try {
      row = db.prepare('SELECT commissionPercent FROM drivers WHERE id = ?').get(box.driverId);
    } catch (e) {
      row = null;
    }
    const pct = normalizeDriverCommissionPercent(row?.commissionPercent, defaultPct);
    return {
      commissionType: 'percent',
      commissionValue: round2(pct),
      earningsJod: computeDriverEarningsJod(box?.deliveryFee, 'percent', pct),
    };
  }
  return {
    commissionType: global.type,
    commissionValue: global.value,
    earningsJod: computeDriverEarningsJod(box?.deliveryFee, global.type, global.value),
  };
}

function writeArhebBoxDriverEarningsSnapshot(db, requestId, driverId) {
  if (!db || requestId == null || driverId == null) return;
  ensureArhebBoxDriverShareColumns(db);
  const box = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
  if (!box) return;
  const defaultPct = getDriverDeliveryDefaultPercent(db);
  let driverRow;
  try {
    driverRow = db.prepare('SELECT commissionPercent FROM drivers WHERE id = ?').get(driverId);
  } catch (e) {
    driverRow = null;
  }
  const pct = normalizeDriverCommissionPercent(driverRow?.commissionPercent, defaultPct);
  const earnings = computeDriverEarningsJod(box.deliveryFee, 'percent', pct);
  db.prepare(
    `UPDATE arheb_box_requests SET driverCommissionType = ?, driverCommissionValue = ?, driverEarnings = ? WHERE id = ?`,
  ).run('percent', pct, earnings, requestId);
}

function assignDriverToOrder(db, orderId, driverId, driverName, status) {
  ensureOrderDriverShareColumns(db);
  ensureDriverCommissionPercentColumn(db);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const defaultPct = getDriverDeliveryDefaultPercent(db);
  let driverRow;
  try {
    driverRow = db.prepare('SELECT commissionPercent FROM drivers WHERE id = ?').get(driverId);
  } catch (e) {
    driverRow = null;
  }
  const pct = normalizeDriverCommissionPercent(driverRow?.commissionPercent, defaultPct);
  const earnings = computeDriverEarningsJod(order.deliveryFee, 'percent', pct);
  db.prepare(
    `UPDATE orders SET driverId = ?, driverName = ?, status = ?,
      driverCommissionType = ?, driverCommissionValue = ?, driverEarnings = ?
    WHERE id = ?`
  ).run(driverId, driverName, status, 'percent', pct, earnings, orderId);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

/** Recompute rating + ratingCount on every driver from driver_ratings (safe to run on startup). */
function syncAllDriverRatingsFromTable(db) {
  ensureDriverRatingsTable(db);
  try {
    db.exec(`
      UPDATE drivers SET
        ratingCount = (SELECT COUNT(*) FROM driver_ratings r WHERE r.driverId = drivers.id),
        rating = COALESCE((SELECT AVG(r.rating) FROM driver_ratings r WHERE r.driverId = drivers.id), drivers.rating);
    `);
  } catch (e) {
    /* ignore if drivers table missing columns mid-migration */
  }
}

module.exports = {
  MAX_DELIVERY_FEE_JOD,
  round2,
  ensureDriverCommissionSettingsTable,
  ensureOrderDriverShareColumns,
  ensureArhebBoxDriverShareColumns,
  ensureDriverRatingsTable,
  ensureDriverCommissionPercentColumn,
  ensureContactUsDriverDeliveryPercentColumn,
  ensureContactUsArhebBoxComingSoonColumn,
  getDriverDeliveryDefaultPercent,
  normalizeDriverCommissionPercent,
  parseDriverCommissionPercentForStorage,
  getDriverCommissionSettings,
  setDriverCommissionSettings,
  computeDriverEarningsJod,
  resolveOrderDriverShare,
  resolveArhebBoxDriverShare,
  writeArhebBoxDriverEarningsSnapshot,
  assignDriverToOrder,
  syncAllDriverRatingsFromTable,
};
