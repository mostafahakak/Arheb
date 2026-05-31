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

/** Per-driver commission rate (share of delivery fee), 0–1 e.g. 0.65 = 65%. Legacy; prefer commissionType + commissionValue. */
function ensureDriverCommissionPercentColumn(db) {
  try {
    db.exec(`ALTER TABLE drivers ADD COLUMN commissionPercent REAL`);
  } catch (e) {
    /* exists */
  }
}

/** Per-driver commission override: "percent" | "fixed" + numeric value (same model as global settings). */
function ensureDriverCommissionRuleColumns(db) {
  if (!db) return;
  try {
    db.exec(`ALTER TABLE drivers ADD COLUMN commissionType TEXT`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE drivers ADD COLUMN commissionValue REAL`);
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

/** App info: platform Arheb Box service fee (JOD); {@link getArhebBoxServiceFeeJod} reads latest App info row. */
function ensureContactUsArhebBoxServiceFeeJodColumn(db) {
  if (!db) return;
  try {
    db.exec(`ALTER TABLE contact_us ADD COLUMN arhebBoxServiceFeeJod REAL`);
  } catch (e) {
    /* exists */
  }
  try {
    db.prepare(`UPDATE contact_us SET arhebBoxServiceFeeJod = ? WHERE arhebBoxServiceFeeJod IS NULL`).run(0);
  } catch (e) {
    /* ignore */
  }
}

/** App info: Pause e-invoice (JoFotara) submissions globally. Default: not paused. */
function ensureContactUsEinvoicePausedColumn(db) {
  if (!db) return;
  try {
    db.exec(`ALTER TABLE contact_us ADD COLUMN einvoicePaused INTEGER DEFAULT 0`);
  } catch (e) {
    /* exists */
  }
}

/** SQLite / API may surface flags as 1, '1', true, or bigint; normalize. */
function contactUsEinvoicePausedIsTruthy(raw) {
  if (raw === true || raw === 1) return true;
  if (typeof raw === 'bigint' && raw === 1n) return true;
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * Latest App info row (by updatedAt, then id). Avoids reading an old duplicate contact_us row.
 * @param {import('better-sqlite3').Database} db
 * @returns {Record<string, unknown>|undefined}
 */
function selectContactUsLatestRow(db) {
  if (!db) return undefined;
  ensureContactUsEinvoicePausedColumn(db);
  try {
    return db
      .prepare(
        `SELECT * FROM contact_us
         ORDER BY COALESCE(NULLIF(TRIM(updatedAt), ''), '') DESC, id DESC
         LIMIT 1`,
      )
      .get();
  } catch (e) {
    return undefined;
  }
}

/**
 * Arheb Box parcel checkout: service fee (JOD) from App info (`contact_us.arhebBoxServiceFeeJod`, latest row).
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
function getArhebBoxServiceFeeJod(db) {
  if (!db) return 0;
  try {
    ensureContactUsArhebBoxServiceFeeJodColumn(db);
    const row = selectContactUsLatestRow(db);
    if (!row) return 0;
    const raw = row.arhebBoxServiceFeeJod;
    if (raw == null || String(raw).trim() === '') return 0;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return 0;
    return round2(v);
  } catch (e) {
    return 0;
  }
}

/** Minimum app versions for user apps (GET /api/app_version; set via PATCH /api/admin/info). */
function ensureContactUsAppVersionColumns(db) {
  if (!db) return;
  try {
    db.exec(`ALTER TABLE contact_us ADD COLUMN appVersionAndroid TEXT`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE contact_us ADD COLUMN appVersionIos TEXT`);
  } catch (e) {
    /* exists */
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {{ android: string, ios: string }}
 */
function getContactAppVersions(db) {
  ensureContactUsAppVersionColumns(db);
  try {
    const row = selectContactUsLatestRow(db);
    const android =
      row && row.appVersionAndroid != null && String(row.appVersionAndroid).trim() !== ''
        ? String(row.appVersionAndroid).trim()
        : '';
    const ios =
      row && row.appVersionIos != null && String(row.appVersionIos).trim() !== ''
        ? String(row.appVersionIos).trim()
        : '';
    return { android, ios };
  } catch (e) {
    return { android: '', ios: '' };
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean}
 */
function isEinvoicePaused(db) {
  const envRaw = String(
    process.env.JOFOTARA_PAUSED ?? process.env.EINVOICE_PAUSED ?? '',
  )
    .trim()
    .toLowerCase();
  if (envRaw === '1' || envRaw === 'true' || envRaw === 'yes') return true;
  if (!db) return false;
  try {
    const row = selectContactUsLatestRow(db);
    if (row && contactUsEinvoicePausedIsTruthy(row.einvoicePaused)) return true;
  } catch (e) {
    /* no table */
  }
  return false;
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

/**
 * App-wide default when a driver has no override: App info `driverDeliveryPercent` (percent), else global settings on App info page.
 * @returns {{ type: 'percent'|'fixed', value: number, source: 'app_info'|'global' }}
 */
function getDriverDefaultCommissionRule(db) {
  ensureDriverCommissionSettingsTable(db);
  ensureContactUsDriverDeliveryPercentColumn(db);
  const global = getDriverCommissionSettings(db);
  const fallbackPct = global.type === 'percent' ? global.value : 0.65;
  try {
    const row = db.prepare('SELECT driverDeliveryPercent FROM contact_us ORDER BY id DESC LIMIT 1').get();
    if (row && row.driverDeliveryPercent != null && String(row.driverDeliveryPercent).trim() !== '') {
      return {
        type: 'percent',
        value: normalizeDriverCommissionPercent(Number(row.driverDeliveryPercent), fallbackPct),
        source: 'app_info',
      };
    }
  } catch (e) {
    /* no contact_us */
  }
  return { type: global.type, value: global.value, source: 'global' };
}

function driverRowHasCustomCommission(row) {
  if (!row) return false;
  if (row.commissionType != null && String(row.commissionType).trim() !== '' && row.commissionValue != null) {
    return true;
  }
  if (row.commissionPercent != null && String(row.commissionPercent).trim() !== '') return true;
  return false;
}

/**
 * Effective commission for a driver (custom override or app default).
 * @returns {{ type: 'percent'|'fixed', value: number, isCustom: boolean, source?: string }}
 */
function resolveDriverCommissionRule(db, driverId) {
  const defaultRule = getDriverDefaultCommissionRule(db);
  if (driverId == null) {
    return { ...defaultRule, isCustom: false };
  }
  ensureDriverCommissionPercentColumn(db);
  ensureDriverCommissionRuleColumns(db);
  let row;
  try {
    row = db
      .prepare('SELECT commissionPercent, commissionType, commissionValue FROM drivers WHERE id = ?')
      .get(driverId);
  } catch (e) {
    return { ...defaultRule, isCustom: false };
  }
  if (!driverRowHasCustomCommission(row)) {
    return { ...defaultRule, isCustom: false };
  }
  const ct = row.commissionType === 'fixed' ? 'fixed' : row.commissionType === 'percent' ? 'percent' : null;
  if (ct && row.commissionValue != null) {
    if (ct === 'fixed') {
      const v = Number(row.commissionValue);
      if (Number.isFinite(v) && v >= 0) {
        return { type: 'fixed', value: v, isCustom: true, source: 'driver' };
      }
    } else {
      const v = normalizeDriverCommissionPercent(row.commissionValue, defaultRule.value);
      return { type: 'percent', value: v, isCustom: true, source: 'driver' };
    }
  }
  const pct = normalizeDriverCommissionPercent(
    row.commissionPercent,
    defaultRule.type === 'percent' ? defaultRule.value : 0.65,
  );
  return { type: 'percent', value: pct, isCustom: true, source: 'driver' };
}

/**
 * Admin PATCH body: { useAppDefaultCommission?, commissionType?, commissionValue? } or legacy commissionPercent.
 * @returns {{ clear?: true, type?: string, value?: number }|undefined}
 */
function parseDriverCommissionRuleForStorage(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (body.useAppDefaultCommission === true) {
    return { clear: true };
  }
  const typeRaw = body.commissionType;
  const valueRaw = body.commissionValue;
  if (typeRaw === undefined && valueRaw === undefined) return undefined;
  const type = typeRaw === 'fixed' ? 'fixed' : typeRaw === 'percent' ? 'percent' : null;
  if (!type) {
    const err = new Error('commissionType must be "fixed" or "percent"');
    err.code = 'VALIDATION';
    throw err;
  }
  let value = Number(valueRaw);
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
  return { type, value };
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
  if (order && order.driverId != null) {
    const rule = resolveDriverCommissionRule(db, order.driverId);
    return {
      commissionType: rule.type,
      commissionValue: round2(rule.value),
      earningsJod: computeDriverEarningsJod(order?.deliveryFee, rule.type, rule.value),
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
  if (box && box.driverId != null) {
    const rule = resolveDriverCommissionRule(db, box.driverId);
    return {
      commissionType: rule.type,
      commissionValue: round2(rule.value),
      earningsJod: computeDriverEarningsJod(box?.deliveryFee, rule.type, rule.value),
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
  const rule = resolveDriverCommissionRule(db, driverId);
  const earnings = computeDriverEarningsJod(box.deliveryFee, rule.type, rule.value);
  db.prepare(
    `UPDATE arheb_box_requests SET driverCommissionType = ?, driverCommissionValue = ?, driverEarnings = ? WHERE id = ?`,
  ).run(rule.type, rule.value, earnings, requestId);
}

function assignDriverToOrder(db, orderId, driverId, driverName, status) {
  ensureOrderDriverShareColumns(db);
  ensureDriverCommissionPercentColumn(db);
  ensureDriverCommissionRuleColumns(db);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const rule = resolveDriverCommissionRule(db, driverId);
  const earnings = computeDriverEarningsJod(order.deliveryFee, rule.type, rule.value);
  db.prepare(
    `UPDATE orders SET driverId = ?, driverName = ?, status = ?,
      driverCommissionType = ?, driverCommissionValue = ?, driverEarnings = ?
    WHERE id = ?`
  ).run(driverId, driverName, status, rule.type, rule.value, earnings, orderId);
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
  ensureDriverCommissionRuleColumns,
  ensureContactUsDriverDeliveryPercentColumn,
  ensureContactUsArhebBoxComingSoonColumn,
  ensureContactUsArhebBoxServiceFeeJodColumn,
  getArhebBoxServiceFeeJod,
  ensureContactUsEinvoicePausedColumn,
  ensureContactUsAppVersionColumns,
  getContactAppVersions,
  selectContactUsLatestRow,
  contactUsEinvoicePausedIsTruthy,
  isEinvoicePaused,
  getDriverDeliveryDefaultPercent,
  normalizeDriverCommissionPercent,
  parseDriverCommissionPercentForStorage,
  getDriverDefaultCommissionRule,
  resolveDriverCommissionRule,
  parseDriverCommissionRuleForStorage,
  driverRowHasCustomCommission,
  getDriverCommissionSettings,
  setDriverCommissionSettings,
  computeDriverEarningsJod,
  resolveOrderDriverShare,
  resolveArhebBoxDriverShare,
  writeArhebBoxDriverEarningsSnapshot,
  assignDriverToOrder,
  syncAllDriverRatingsFromTable,
};
