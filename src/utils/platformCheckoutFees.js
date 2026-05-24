const { STORE_MAX_JOD, STORE_ORDER_SERVICE_FEE_JOD } = require('./deliveryFees');

const DEFAULT_ROW = {
  firstKmJod: 1,
  perKmJod: 0.1,
  maxJod: STORE_MAX_JOD,
  defaultServiceFeeJod: STORE_ORDER_SERVICE_FEE_JOD,
  flatDeliveryFeeJod: null,
  deliveryOverCartThresholdJod: null,
  deliveryFeeAboveJod: null,
  arhebBoxFirstKmJod: 1,
  arhebBoxPerKmJod: 0.5,
  arhebBoxMaxJod: null,
  specialFarDeliveryFeeJod: 10,
};

function ensurePlatformCheckoutFeesTable(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_checkout_fees (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      firstKmJod REAL NOT NULL,
      perKmJod REAL NOT NULL,
      maxJod REAL NOT NULL,
      defaultServiceFeeJod REAL NOT NULL,
      flatDeliveryFeeJod REAL,
      updatedAt TEXT
    );
  `);
  try {
    db.exec(`ALTER TABLE platform_checkout_fees ADD COLUMN flatDeliveryFeeJod REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE platform_checkout_fees ADD COLUMN deliveryOverCartThresholdJod REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE platform_checkout_fees ADD COLUMN deliveryFeeAboveJod REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE platform_checkout_fees ADD COLUMN arhebBoxFirstKmJod REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE platform_checkout_fees ADD COLUMN arhebBoxPerKmJod REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE platform_checkout_fees ADD COLUMN arhebBoxMaxJod REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE platform_checkout_fees ADD COLUMN specialFarDeliveryFeeJod REAL`);
  } catch (e) {
    /* exists */
  }
  const row = db.prepare('SELECT id FROM platform_checkout_fees WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT INTO platform_checkout_fees (
        id, firstKmJod, perKmJod, maxJod, defaultServiceFeeJod, flatDeliveryFeeJod,
        arhebBoxFirstKmJod, arhebBoxPerKmJod, arhebBoxMaxJod, specialFarDeliveryFeeJod, updatedAt
      )
       VALUES (1, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, datetime('now'))`,
    ).run(
      DEFAULT_ROW.firstKmJod,
      DEFAULT_ROW.perKmJod,
      DEFAULT_ROW.maxJod,
      DEFAULT_ROW.defaultServiceFeeJod,
      DEFAULT_ROW.arhebBoxFirstKmJod,
      DEFAULT_ROW.arhebBoxPerKmJod,
      DEFAULT_ROW.specialFarDeliveryFeeJod,
    );
  }
}

/** @param {import('better-sqlite3').Database} db */
function getPlatformCheckoutFeeTiers(db) {
  ensurePlatformCheckoutFeesTable(db);
  const r = db.prepare(
    `SELECT firstKmJod, perKmJod, maxJod, defaultServiceFeeJod, flatDeliveryFeeJod,
      deliveryOverCartThresholdJod, deliveryFeeAboveJod,
      arhebBoxFirstKmJod, arhebBoxPerKmJod, arhebBoxMaxJod, specialFarDeliveryFeeJod
     FROM platform_checkout_fees WHERE id = 1`,
  ).get();
  let flat = null;
  if (r?.flatDeliveryFeeJod != null && String(r.flatDeliveryFeeJod).trim() !== '') {
    const f = Number(r.flatDeliveryFeeJod);
    if (Number.isFinite(f) && f >= 0) flat = f;
  }
  let overThreshold = null;
  if (r?.deliveryOverCartThresholdJod != null && String(r.deliveryOverCartThresholdJod).trim() !== '') {
    const t = Number(r.deliveryOverCartThresholdJod);
    if (Number.isFinite(t) && t >= 0) overThreshold = t;
  }
  let feeAbove = null;
  if (r?.deliveryFeeAboveJod != null && String(r.deliveryFeeAboveJod).trim() !== '') {
    const f = Number(r.deliveryFeeAboveJod);
    if (Number.isFinite(f) && f >= 0) feeAbove = f;
  }
  let arhebBoxMax = null;
  if (r?.arhebBoxMaxJod != null && String(r.arhebBoxMaxJod).trim() !== '') {
    const m = Number(r.arhebBoxMaxJod);
    if (Number.isFinite(m) && m >= 0) arhebBoxMax = m;
  }
  return {
    firstKmJod: r?.firstKmJod != null ? Number(r.firstKmJod) : DEFAULT_ROW.firstKmJod,
    perKmJod: r?.perKmJod != null ? Number(r.perKmJod) : DEFAULT_ROW.perKmJod,
    maxJod: r?.maxJod != null ? Number(r.maxJod) : DEFAULT_ROW.maxJod,
    defaultServiceFeeJod:
      r?.defaultServiceFeeJod != null ? Number(r.defaultServiceFeeJod) : DEFAULT_ROW.defaultServiceFeeJod,
    flatDeliveryFeeJod: flat,
    deliveryOverCartThresholdJod: overThreshold,
    deliveryFeeAboveJod: feeAbove,
    arhebBoxFirstKmJod:
      r?.arhebBoxFirstKmJod != null ? Number(r.arhebBoxFirstKmJod) : DEFAULT_ROW.arhebBoxFirstKmJod,
    arhebBoxPerKmJod:
      r?.arhebBoxPerKmJod != null ? Number(r.arhebBoxPerKmJod) : DEFAULT_ROW.arhebBoxPerKmJod,
    arhebBoxMaxJod: arhebBoxMax,
    specialFarDeliveryFeeJod:
      r?.specialFarDeliveryFeeJod != null ? Number(r.specialFarDeliveryFeeJod) : DEFAULT_ROW.specialFarDeliveryFeeJod,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ firstKmJod?: number, perKmJod?: number, maxJod?: number, defaultServiceFeeJod?: number, flatDeliveryFeeJod?: number | null }} patch
 */
function setPlatformCheckoutFeeTiers(db, patch) {
  ensurePlatformCheckoutFeesTable(db);
  const cur = getPlatformCheckoutFeeTiers(db);

  function nullableNonNegative(key, label) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return cur[key];
    const raw = patch[key];
    if (raw === undefined) return cur[key];
    if (raw === '' || raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      const err = new Error(`${label || key} must be empty/null or a non-negative number`);
      err.code = 'VALIDATION';
      throw err;
    }
    return n;
  }

  const flatNext = nullableNonNegative('flatDeliveryFeeJod');
  const overThresholdNext = nullableNonNegative('deliveryOverCartThresholdJod');
  const feeAboveNext = nullableNonNegative('deliveryFeeAboveJod');
  const arhebBoxMaxNext = nullableNonNegative('arhebBoxMaxJod');

  if ((overThresholdNext == null) !== (feeAboveNext == null)) {
    const err = new Error(
      'deliveryOverCartThresholdJod and deliveryFeeAboveJod must both be set or both cleared',
    );
    err.code = 'VALIDATION';
    throw err;
  }

  const next = {
    firstKmJod: patch.firstKmJod != null ? Number(patch.firstKmJod) : cur.firstKmJod,
    perKmJod: patch.perKmJod != null ? Number(patch.perKmJod) : cur.perKmJod,
    maxJod: patch.maxJod != null ? Number(patch.maxJod) : cur.maxJod,
    defaultServiceFeeJod:
      patch.defaultServiceFeeJod != null ? Number(patch.defaultServiceFeeJod) : cur.defaultServiceFeeJod,
    flatDeliveryFeeJod: flatNext,
    deliveryOverCartThresholdJod: overThresholdNext,
    deliveryFeeAboveJod: feeAboveNext,
    arhebBoxFirstKmJod:
      patch.arhebBoxFirstKmJod != null ? Number(patch.arhebBoxFirstKmJod) : cur.arhebBoxFirstKmJod,
    arhebBoxPerKmJod:
      patch.arhebBoxPerKmJod != null ? Number(patch.arhebBoxPerKmJod) : cur.arhebBoxPerKmJod,
    arhebBoxMaxJod: arhebBoxMaxNext,
    specialFarDeliveryFeeJod:
      patch.specialFarDeliveryFeeJod != null ? Number(patch.specialFarDeliveryFeeJod) : cur.specialFarDeliveryFeeJod,
  };
  for (const k of [
    'firstKmJod',
    'perKmJod',
    'maxJod',
    'defaultServiceFeeJod',
    'arhebBoxFirstKmJod',
    'arhebBoxPerKmJod',
    'specialFarDeliveryFeeJod',
  ]) {
    if (!Number.isFinite(next[k]) || next[k] < 0) {
      const err = new Error(`${k} must be a non-negative number`);
      err.code = 'VALIDATION';
      throw err;
    }
  }
  db.prepare(
    `UPDATE platform_checkout_fees
     SET firstKmJod = ?, perKmJod = ?, maxJod = ?, defaultServiceFeeJod = ?,
       flatDeliveryFeeJod = ?, deliveryOverCartThresholdJod = ?, deliveryFeeAboveJod = ?,
       arhebBoxFirstKmJod = ?, arhebBoxPerKmJod = ?, arhebBoxMaxJod = ?,
       specialFarDeliveryFeeJod = ?, updatedAt = datetime('now')
     WHERE id = 1`,
  ).run(
    next.firstKmJod,
    next.perKmJod,
    next.maxJod,
    next.defaultServiceFeeJod,
    next.flatDeliveryFeeJod,
    next.deliveryOverCartThresholdJod,
    next.deliveryFeeAboveJod,
    next.arhebBoxFirstKmJod,
    next.arhebBoxPerKmJod,
    next.arhebBoxMaxJod,
    next.specialFarDeliveryFeeJod,
  );
  return getPlatformCheckoutFeeTiers(db);
}

module.exports = {
  ensurePlatformCheckoutFeesTable,
  getPlatformCheckoutFeeTiers,
  setPlatformCheckoutFeeTiers,
  DEFAULT_ROW,
};
