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
  const s = getDriverCommissionSettings(db);
  return {
    commissionType: s.type,
    commissionValue: s.value,
    earningsJod: computeDriverEarningsJod(order?.deliveryFee, s.type, s.value),
  };
}

function assignDriverToOrder(db, orderId, driverId, driverName, status) {
  ensureOrderDriverShareColumns(db);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const s = getDriverCommissionSettings(db);
  const earnings = computeDriverEarningsJod(order.deliveryFee, s.type, s.value);
  db.prepare(
    `UPDATE orders SET driverId = ?, driverName = ?, status = ?,
      driverCommissionType = ?, driverCommissionValue = ?, driverEarnings = ?
    WHERE id = ?`
  ).run(driverId, driverName, status, s.type, s.value, earnings, orderId);
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
  ensureDriverRatingsTable,
  getDriverCommissionSettings,
  setDriverCommissionSettings,
  computeDriverEarningsJod,
  resolveOrderDriverShare,
  assignDriverToOrder,
  syncAllDriverRatingsFromTable,
};
