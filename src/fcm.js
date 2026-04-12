/**
 * Firebase Cloud Messaging (FCM) helper using Firebase Admin SDK.
 * Send push notifications to drivers, users, or all users (broadcast).
 *
 * Requires: FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON) or GOOGLE_APPLICATION_CREDENTIALS path.
 *
 * Driver and customer apps can share one Firebase project: use FIREBASE_SERVICE_ACCOUNT_JSON only.
 */

const { getStoreFcmToken } = require('./storeFcm');
const { jordanMobileLookupKeys, normalizeJordanMobileKey } = require('./utils/jordanMobile');

let admin = null;
let messaging = null;

function fcmDebugEnabled() {
  const v = process.env.FCM_DEBUG;
  return v === '1' || String(v).toLowerCase() === 'true';
}

/** Short phone for logs (avoid logging full numbers). */
function maskPhoneForLog(phone) {
  const s = String(phone ?? '').trim();
  if (!s) return '(empty)';
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}…${s.slice(-3)}`;
}

function logFcmSend(kind, info) {
  const line = { kind, ...info };
  if (line.extra === undefined) delete line.extra;
  console.log('[fcm]', line);
  if (fcmDebugEnabled() && info.extra != null) {
    console.log('[fcm-debug]', info.extra);
  }
}

/**
 * Initialize firebase-admin once; returns the admin namespace or null if unavailable.
 */
function ensureFirebaseAdmin() {
  if (admin?.apps?.length) return admin;
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
  } catch (e) {
    console.warn('fcm: Failed to initialize Firebase Admin:', e.message);
    return null;
  }
  return admin;
}

function getMessaging() {
  const a = ensureFirebaseAdmin();
  if (!a) return null;
  if (!messaging) {
    try {
      messaging = a.messaging();
    } catch (e) {
      console.warn('fcm: messaging() failed:', e.message);
      return null;
    }
  }
  return messaging;
}

/** Same FCM project as customers (single FIREBASE_SERVICE_ACCOUNT_JSON). Kept for call-site compatibility. */
function getMessagingForDriver() {
  return getMessaging();
}

/** Firebase Auth (verifyIdToken, etc.). Same credentials as FCM. */
function getAuth() {
  const a = ensureFirebaseAdmin();
  if (!a) return null;
  try {
    return a.auth();
  } catch (e) {
    console.warn('fcm: auth() failed:', e.message);
    return null;
  }
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
 * Persist a row in user_notifications so the in-app inbox matches pushes sent to this user.
 */
function insertUserNotification(db, phoneNumber, title, body, imageUrl, data) {
  if (!db || !phoneNumber) return;
  try {
    let dataJson = null;
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      dataJson = JSON.stringify(data);
    }
    db.prepare(
      `INSERT INTO user_notifications (phoneNumber, title, body, imageUrl, dataJson)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      phoneNumber,
      title || 'Notification',
      body != null ? String(body) : null,
      imageUrl && typeof imageUrl === 'string' ? imageUrl.trim() || null : null,
      dataJson
    );
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) {
      console.warn('user_notifications insert failed:', e.message);
    }
  }
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
async function sendToTokenWithMessaging(m, token, title, body, imageUrl, data, options = {}) {
  if (!token || typeof token !== 'string' || !token.trim()) return null;
  if (!m) return null;
  const payload = buildMessagePayload(title, body, imageUrl, data);
  const message = { ...payload, token };
  if (options.highPriority) {
    message.android = { priority: 'high' };
    message.apns = {
      payload: {
        aps: {
          sound: 'default',
        },
      },
    };
  }
  try {
    const result = await m.send(message);
    if (fcmDebugEnabled()) {
      console.log('[fcm-debug] send raw ok messageId=', result);
    }
    return result;
  } catch (e) {
    console.warn('[fcm] send failed:', e.message);
    return null;
  }
}

async function sendToToken(token, title, body, imageUrl, data, options = {}) {
  return sendToTokenWithMessaging(getMessaging(), token, title, body, imageUrl, data, options);
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
async function sendToTokensWithMessaging(m, tokens, title, body, imageUrl, data) {
  const list = (tokens || []).filter((t) => t && typeof t === 'string' && t.trim());
  if (list.length === 0) return { successCount: 0, failureCount: 0 };
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
      console.warn('[fcm] sendToTokens batch failed:', e.message);
      failureCount += batch.length;
    }
  }
  return { successCount, failureCount };
}

async function sendToTokens(tokens, title, body, imageUrl, data) {
  return sendToTokensWithMessaging(getMessaging(), tokens, title, body, imageUrl, data);
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
  if (!db || driverId == null) {
    logFcmSend('driver_skip', { reason: 'missing_db_or_driverId' });
    return null;
  }
  const stmt = db.prepare('SELECT fcmToken FROM drivers WHERE id = ? AND fcmToken IS NOT NULL AND fcmToken != ?');
  const row = stmt.get(driverId, '');
  const hasToken = !!(row?.fcmToken && String(row.fcmToken).trim());
  logFcmSend('driver_send', {
    driverId,
    hasToken,
    title: title != null ? String(title).slice(0, 80) : '',
    notifyType: data?.type != null ? String(data.type) : undefined,
    extra: fcmDebugEnabled() && hasToken ? { tokenLen: String(row.fcmToken).length } : undefined,
  });
  const m = getMessagingForDriver();
  if (!m) {
    logFcmSend('driver_skip', { driverId, reason: 'firebase_messaging_unavailable' });
    return null;
  }
  const out = await sendToTokenWithMessaging(m, row?.fcmToken, title, body, null, data, { highPriority: true });
  logFcmSend('driver_result', { driverId, ok: !!out, messageId: out || null });
  return out;
}

/**
 * Send to multiple drivers by driverIds.
 */
async function sendToDrivers(db, driverIds, title, body, data = {}) {
  if (!db || !Array.isArray(driverIds) || driverIds.length === 0) {
    logFcmSend('drivers_batch_skip', { reason: 'missing_db_or_ids' });
    return { successCount: 0, failureCount: 0 };
  }
  const placeholders = driverIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT fcmToken FROM drivers WHERE id IN (${placeholders}) AND fcmToken IS NOT NULL AND fcmToken != ''`).all(...driverIds);
  const tokens = rows.map((r) => r.fcmToken).filter(Boolean);
  logFcmSend('drivers_batch_send', {
    requestedIds: driverIds.length,
    tokensResolved: tokens.length,
    title: title != null ? String(title).slice(0, 80) : '',
    notifyType: data?.type != null ? String(data.type) : undefined,
  });
  const m = getMessagingForDriver();
  if (!m) return { successCount: 0, failureCount: tokens.length };
  const result = await sendToTokensWithMessaging(m, tokens, title, body, null, data);
  logFcmSend('drivers_batch_result', result);
  return result;
}

/**
 * Send push to a store’s registered device (token in store_fcm_tokens).
 * @param {object} db
 * @param {string|number} storeId
 * @param {string} title
 * @param {string} body
 * @param {object} [data]
 * @returns {Promise<string|null>}
 */
async function sendToStore(db, storeId, title, body, data = {}) {
  if (!db || storeId == null || String(storeId).trim() === '') {
    console.warn('[fcm] store notify skipped: missing storeId');
    return null;
  }
  const sid = String(storeId).trim();
  const token = getStoreFcmToken(db, sid);
  if (!token) {
    console.warn('[fcm] store notify: no FCM token registered for storeId=%s (POST /api/store/update-fcm)', sid);
    return null;
  }
  if (!getMessaging()) {
    console.warn('[fcm] store notify: Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON)');
    return null;
  }
  return sendToToken(token, title, body, null, data, { highPriority: true });
}

/**
 * Send to user by phoneNumber (looks up fcmToken from users table).
 * Tries all Jordan mobile key variants (079… vs 962… vs +962…) so order.phoneNumber can differ from users.phoneNumber.
 */
async function sendToUserByPhone(db, phoneNumber, title, body, imageUrl, data = {}) {
  if (!db || !phoneNumber) {
    logFcmSend('customer_skip', { reason: 'missing_db_or_phone' });
    return null;
  }
  const keys = jordanMobileLookupKeys(phoneNumber);
  if (keys.length === 0) {
    logFcmSend('customer_skip', { phone: maskPhoneForLog(phoneNumber), reason: 'no_lookup_keys' });
    return null;
  }
  const placeholders = keys.map(() => '?').join(',');
  let row;
  try {
    row = db
      .prepare(
        `SELECT phoneNumber, fcmToken FROM users WHERE phoneNumber IN (${placeholders}) AND fcmToken IS NOT NULL AND fcmToken != '' LIMIT 1`,
      )
      .get(...keys);
  } catch (e) {
    row = null;
  }
  const hasToken = !!(row?.fcmToken && String(row.fcmToken).trim());
  logFcmSend('customer_send', {
    phone: maskPhoneForLog(phoneNumber),
    lookupKeyCount: keys.length,
    matchedUserToken: hasToken,
    title: title != null ? String(title).slice(0, 80) : '',
    notifyType: data?.type != null ? String(data.type) : undefined,
    extra: fcmDebugEnabled() && hasToken ? { tokenLen: String(row.fcmToken).length } : undefined,
  });
  const inboxPhone = row?.phoneNumber || normalizeJordanMobileKey(phoneNumber) || String(phoneNumber).trim();
  insertUserNotification(db, inboxPhone, title, body, imageUrl, data);
  if (!getMessaging()) {
    logFcmSend('customer_skip', { phone: maskPhoneForLog(phoneNumber), reason: 'firebase_messaging_unavailable' });
    return null;
  }
  const out = await sendToToken(row?.fcmToken, title, body, imageUrl, data);
  logFcmSend('customer_result', {
    phone: maskPhoneForLog(phoneNumber),
    ok: !!out,
    hadToken: hasToken,
    messageId: out || null,
  });
  return out;
}

/**
 * Send to all users that have fcmToken (broadcast).
 */
async function sendToAllUsers(db, title, body, imageUrl, data = {}) {
  if (!db) return { successCount: 0, failureCount: 0 };
  const rows = db.prepare("SELECT phoneNumber, fcmToken FROM users WHERE fcmToken IS NOT NULL AND fcmToken != ''").all();
  for (const r of rows) {
    if (r.phoneNumber) insertUserNotification(db, r.phoneNumber, title, body, imageUrl, data);
  }
  const tokens = rows.map((r) => r.fcmToken).filter(Boolean);
  return sendToTokens(tokens, title, body, imageUrl, data);
}

module.exports = {
  ensureFirebaseAdmin,
  getMessaging,
  getMessagingForDriver,
  getAuth,
  sendToToken,
  sendToTokens,
  sendToDriver,
  sendToDrivers,
  sendToStore,
  sendToUserByPhone,
  sendToAllUsers,
  insertUserNotification,
};
