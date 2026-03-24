/**
 * Firebase Cloud Messaging (FCM) helper using Firebase Admin SDK.
 * Send push notifications to drivers, users, or all users (broadcast).
 *
 * Requires: FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON) or GOOGLE_APPLICATION_CREDENTIALS path.
 */

let admin = null;
let messaging = null;

function getMessaging() {
  if (messaging) return messaging;
  if (!admin) {
    try {
      admin = require('firebase-admin');
    } catch (e) {
      console.warn('fcm: firebase-admin not installed. Run: npm install firebase-admin');
      return null;
    }
  }
  try {
    if (!admin.apps.length) {
      const cred = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (cred && typeof cred === 'string' && cred.trim()) {
        const serviceAccount = JSON.parse(cred);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id,
        });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } else {
        console.warn(
          'fcm: Set FIREBASE_SERVICE_ACCOUNT_JSON (stringified Firebase service account JSON) or GOOGLE_APPLICATION_CREDENTIALS — push notifications disabled'
        );
        return null;
      }
    }
    messaging = admin.messaging();
  } catch (e) {
    console.warn('fcm: Failed to initialize Firebase Admin:', e.message);
    return null;
  }
  return messaging;
}

/**
 * Build notification + data payload for FCM.
 * @param {string} title
 * @param {string} body
 * @param {string} [imageUrl]
 * @param {object} [data] - key-value string pairs for client
 */
function buildMessagePayload(title, body, imageUrl, data = {}) {
  const message = {
    notification: {
      title: title || 'Notification',
      body: body || '',
      ...(imageUrl && { image: imageUrl }),
    },
    data: Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [String(k), String(v)])
    ),
  };
  return message;
}

/**
 * Send FCM to a single token.
 * @param {string} token
 * @param {string} title
 * @param {string} body
 * @param {string} [imageUrl]
 * @param {object} [data]
 * @returns {Promise<string|null>} messageId or null on failure
 */
async function sendToToken(token, title, body, imageUrl, data) {
  if (!token || typeof token !== 'string' || !token.trim()) return null;
  const m = getMessaging();
  if (!m) return null;
  const payload = buildMessagePayload(title, body, imageUrl, data);
  try {
    const result = await m.send({ ...payload, token });
    return result;
  } catch (e) {
    console.warn('fcm sendToToken failed:', e.message);
    return null;
  }
}

/**
 * Send same notification to multiple tokens (batch; FCM allows up to 500).
 * @param {string[]} tokens
 * @param {string} title
 * @param {string} body
 * @param {string} [imageUrl]
 * @param {object} [data]
 * @returns {Promise<{ successCount: number, failureCount: number }>}
 */
async function sendToTokens(tokens, title, body, imageUrl, data) {
  const list = (tokens || []).filter((t) => t && typeof t === 'string' && t.trim());
  if (list.length === 0) return { successCount: 0, failureCount: 0 };
  const m = getMessaging();
  if (!m) return { successCount: 0, failureCount: list.length };
  const payload = buildMessagePayload(title, body, imageUrl, data);
  const BATCH = 500;
  let successCount = 0;
  let failureCount = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    try {
      const result = await m.sendEachForMulticast({
        ...payload,
        tokens: batch,
      });
      successCount += result.successCount;
      failureCount += result.failureCount;
    } catch (e) {
      console.warn('fcm sendToTokens batch failed:', e.message);
      failureCount += batch.length;
    }
  }
  return { successCount, failureCount };
}

/**
 * Send to a driver by driverId (looks up fcmToken from db).
 * @param {object} db - better-sqlite3 database
 * @param {number} driverId
 * @param {string} title
 * @param {string} body
 * @param {object} [data]
 */
async function sendToDriver(db, driverId, title, body, data = {}) {
  if (!db || driverId == null) return null;
  const stmt = db.prepare('SELECT fcmToken FROM drivers WHERE id = ? AND fcmToken IS NOT NULL AND fcmToken != ?');
  const row = stmt.get(driverId, '');
  return sendToToken(row?.fcmToken, title, body, null, data);
}

/**
 * Send to multiple drivers by driverIds.
 */
async function sendToDrivers(db, driverIds, title, body, data = {}) {
  if (!db || !Array.isArray(driverIds) || driverIds.length === 0) return { successCount: 0, failureCount: 0 };
  const placeholders = driverIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT fcmToken FROM drivers WHERE id IN (${placeholders}) AND fcmToken IS NOT NULL AND fcmToken != ''`).all(...driverIds);
  const tokens = rows.map((r) => r.fcmToken).filter(Boolean);
  return sendToTokens(tokens, title, body, null, data);
}

/**
 * Send to user by phoneNumber (looks up fcmToken from users table).
 */
async function sendToUserByPhone(db, phoneNumber, title, body, imageUrl, data = {}) {
  if (!db || !phoneNumber) return null;
  const row = db.prepare('SELECT fcmToken FROM users WHERE phoneNumber = ? AND fcmToken IS NOT NULL AND fcmToken != ?').get(phoneNumber, '');
  return sendToToken(row?.fcmToken, title, body, imageUrl, data);
}

/**
 * Send to all users that have fcmToken (broadcast).
 */
async function sendToAllUsers(db, title, body, imageUrl, data = {}) {
  if (!db) return { successCount: 0, failureCount: 0 };
  const rows = db.prepare("SELECT fcmToken FROM users WHERE fcmToken IS NOT NULL AND fcmToken != ''").all();
  const tokens = rows.map((r) => r.fcmToken).filter(Boolean);
  return sendToTokens(tokens, title, body, imageUrl, data);
}

module.exports = {
  getMessaging,
  sendToToken,
  sendToTokens,
  sendToDriver,
  sendToDrivers,
  sendToUserByPhone,
  sendToAllUsers,
};
