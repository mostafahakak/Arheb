/**
 * Persist FCM device tokens per store (SQLite). Store catalog remains in JSON;
 * tokens are updated via POST /api/store/update-fcm and read when sending pushes.
 */

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
  const sid = String(storeId ?? '').trim();
  if (!sid) return;
  const trimmed = fcmToken != null && typeof fcmToken === 'string' ? fcmToken.trim() : '';
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
  const sid = String(storeId ?? '').trim();
  if (!sid) return null;
  const row = db.prepare('SELECT fcmToken FROM store_fcm_tokens WHERE storeId = ?').get(sid);
  const t = row?.fcmToken;
  if (!t || typeof t !== 'string' || !t.trim()) return null;
  return t.trim();
}

module.exports = {
  ensureStoreFcmTable,
  upsertStoreFcmToken,
  getStoreFcmToken,
};
