const { selectContactUsLatestRow } = require('./driverCommission');

function envTruthy(name) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** App info: pause all public APIs (checkout, orders, auth OTP, driver, etc.). Default: not paused. */
function ensureContactUsApiPausedColumn(db) {
  if (!db) return;
  try {
    db.exec(`ALTER TABLE contact_us ADD COLUMN apiPaused INTEGER DEFAULT 0`);
  } catch (e) {
    /* exists */
  }
}

function contactUsApiPausedIsTruthy(raw) {
  if (raw === true || raw === 1) return true;
  if (typeof raw === 'bigint' && raw === 1n) return true;
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

let cached = { value: false, checkedAt: 0 };
const CACHE_TTL_MS = 2000;

function invalidateApiPauseCache() {
  cached.checkedAt = 0;
}

/**
 * @param {import('better-sqlite3').Database} [db]
 * @returns {boolean}
 */
function isApiPaused(db) {
  if (envTruthy('ARHEB_API_PAUSED') || envTruthy('API_PAUSED')) return true;
  if (!db) return false;

  const now = Date.now();
  if (cached.checkedAt && now - cached.checkedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  let paused = false;
  try {
    ensureContactUsApiPausedColumn(db);
    const row = selectContactUsLatestRow(db);
    if (row && contactUsApiPausedIsTruthy(row.apiPaused)) paused = true;
  } catch (e) {
    /* no table */
  }

  cached = { value: paused, checkedAt: now };
  return paused;
}

function isApiPausedEnvForced() {
  return envTruthy('ARHEB_API_PAUSED') || envTruthy('API_PAUSED');
}

module.exports = {
  ensureContactUsApiPausedColumn,
  contactUsApiPausedIsTruthy,
  isApiPaused,
  isApiPausedEnvForced,
  invalidateApiPauseCache,
};
