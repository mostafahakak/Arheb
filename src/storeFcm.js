/**
 * Persist FCM device tokens per store (SQLite). Store catalog remains in JSON;
 * tokens are updated via POST /api/store/update-fcm and read when sending pushes.
 */

const fs = require('fs');
const { getJsonPath } = require('./config/jsonPaths');

/** Cache stores list by catalog file mtime. */
let _storesCache = { mtime: 0, list: null };

function loadStoresListCached() {
  try {
    const p = getJsonPath('stores_listing_response.json');
    const mtime = fs.statSync(p).mtimeMs;
    if (_storesCache.list && mtime === _storesCache.mtime) {
      return _storesCache.list;
    }
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = data?.data?.stores ?? [];
    _storesCache = { mtime, list };
    return list;
  } catch {
    return [];
  }
}

/**
 * Resolve the store id string as used in stores JSON (matches product store.id).
 * Helps when client/order use numeric vs string or equivalent numeric forms.
 */
function canonicalStoreId(storeId) {
  const raw = String(storeId ?? '').trim();
  if (!raw) return null;
  const stores = loadStoresListCached();
  const exact = stores.find((s) => String(s.id) === raw);
  if (exact) return String(exact.id);
  const rn = Number(raw);
  if (!Number.isNaN(rn)) {
    const num = stores.find((s) => !Number.isNaN(Number(s.id)) && Number(s.id) === rn);
    if (num) return String(num.id);
  }
  return raw;
}

function ensureStoreFcmTable(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_fcm_tokens (
      storeId TEXT PRIMARY KEY NOT NULL,
      fcmToken TEXT,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string|number} storeId
 * @param {string|null|undefined} fcmToken
 */
function upsertStoreFcmToken(db, storeId, fcmToken) {
  const sid = canonicalStoreId(storeId) || String(storeId ?? '').trim();
  if (!sid) return;
  const trimmed =
    fcmToken != null && fcmToken !== ''
      ? String(fcmToken).trim()
      : '';
  const tokenVal = trimmed ? trimmed : null;
  db.prepare(`
    INSERT INTO store_fcm_tokens (storeId, fcmToken, updatedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(storeId) DO UPDATE SET
      fcmToken = excluded.fcmToken,
      updatedAt = datetime('now')
  `).run(sid, tokenVal);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string|number} storeId
 * @returns {string|null}
 */
function getStoreFcmToken(db, storeId) {
  const raw = String(storeId ?? '').trim();
  if (!raw) return null;
  const canon = canonicalStoreId(storeId) || raw;
  const keys = canon === raw ? [raw] : [canon, raw];
  for (const key of keys) {
    const row = db.prepare('SELECT fcmToken FROM store_fcm_tokens WHERE storeId = ?').get(key);
    const t = row?.fcmToken;
    if (t && typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

module.exports = {
  ensureStoreFcmTable,
  upsertStoreFcmToken,
  getStoreFcmToken,
  canonicalStoreId,
};
