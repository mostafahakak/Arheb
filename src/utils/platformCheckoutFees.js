const { STORE_MAX_JOD, STORE_ORDER_SERVICE_FEE_JOD } = require('./deliveryFees');

const DEFAULT_ROW = {
  firstKmJod: 1,
  perKmJod: 0.1,
  maxJod: STORE_MAX_JOD,
  defaultServiceFeeJod: STORE_ORDER_SERVICE_FEE_JOD,
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
      updatedAt TEXT
    );
  `);
  const row = db.prepare('SELECT id FROM platform_checkout_fees WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT INTO platform_checkout_fees (id, firstKmJod, perKmJod, maxJod, defaultServiceFeeJod, updatedAt)
       VALUES (1, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      DEFAULT_ROW.firstKmJod,
      DEFAULT_ROW.perKmJod,
      DEFAULT_ROW.maxJod,
      DEFAULT_ROW.defaultServiceFeeJod,
    );
  }
}

/** @param {import('better-sqlite3').Database} db */
function getPlatformCheckoutFeeTiers(db) {
  ensurePlatformCheckoutFeesTable(db);
  const r = db.prepare('SELECT firstKmJod, perKmJod, maxJod, defaultServiceFeeJod FROM platform_checkout_fees WHERE id = 1').get();
  return {
    firstKmJod: r?.firstKmJod != null ? Number(r.firstKmJod) : DEFAULT_ROW.firstKmJod,
    perKmJod: r?.perKmJod != null ? Number(r.perKmJod) : DEFAULT_ROW.perKmJod,
    maxJod: r?.maxJod != null ? Number(r.maxJod) : DEFAULT_ROW.maxJod,
    defaultServiceFeeJod:
      r?.defaultServiceFeeJod != null ? Number(r.defaultServiceFeeJod) : DEFAULT_ROW.defaultServiceFeeJod,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ firstKmJod?: number, perKmJod?: number, maxJod?: number, defaultServiceFeeJod?: number }} patch
 */
function setPlatformCheckoutFeeTiers(db, patch) {
  ensurePlatformCheckoutFeesTable(db);
  const cur = getPlatformCheckoutFeeTiers(db);
  const next = {
    firstKmJod: patch.firstKmJod != null ? Number(patch.firstKmJod) : cur.firstKmJod,
    perKmJod: patch.perKmJod != null ? Number(patch.perKmJod) : cur.perKmJod,
    maxJod: patch.maxJod != null ? Number(patch.maxJod) : cur.maxJod,
    defaultServiceFeeJod:
      patch.defaultServiceFeeJod != null ? Number(patch.defaultServiceFeeJod) : cur.defaultServiceFeeJod,
  };
  for (const k of ['firstKmJod', 'perKmJod', 'maxJod', 'defaultServiceFeeJod']) {
    if (!Number.isFinite(next[k]) || next[k] < 0) {
      const err = new Error(`${k} must be a non-negative number`);
      err.code = 'VALIDATION';
      throw err;
    }
  }
  db.prepare(
    `UPDATE platform_checkout_fees SET firstKmJod = ?, perKmJod = ?, maxJod = ?, defaultServiceFeeJod = ?, updatedAt = datetime('now') WHERE id = 1`,
  ).run(next.firstKmJod, next.perKmJod, next.maxJod, next.defaultServiceFeeJod);
  return getPlatformCheckoutFeeTiers(db);
}

module.exports = {
  ensurePlatformCheckoutFeesTable,
  getPlatformCheckoutFeeTiers,
  setPlatformCheckoutFeeTiers,
  DEFAULT_ROW,
};
