const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const attachCategoriesRoutes = require('./categories');
const attachFoodTypesRoutes = require('./foodTypes');
const attachProductsRoutes = require('./products');
const attachHomeRoutes = require('./home');
const attachStoresRoutes = require('./stores');
const attachProfileRoutes = require('./profile');
const attachWalletRoutes = require('./wallet');
const attachCheckoutRoutes = require('./checkout');
const attachContactRoutes = require('./contact');
const attachOrderTrackingRoutes = require('./order');
const attachDriverPresence = require('./driverPresence');
const attachMerchantPresence = require('./merchantPresence');
const attachAdmin = require('./admin');
const attachPopupRoutes = require('./popup');
const attachArhebBoxRoutes = require('./arhebBox');
const attachSearchRoutes = require('./search');
const attachDriverRoutes = require('./driver');
const attachPaymentRoutes = require('./payment');
const { getAuth } = require('./fcm');
const { attachAdminDashboardNamespace } = require('./utils/adminDashboardSocket');

dotenv.config();

// Keep the process alive when an error escapes async background work (Socket.IO event
// handlers, timers, FCM/WhatsApp callbacks). Without these, a single uncaught error crashes
// the whole server and Render reports "Instance failed" + restarts. We log the full error so
// the real root cause is visible, instead of taking the entire service down.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException — server kept alive:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection — server kept alive:', reason?.stack || reason);
});

// Render persistent disk defaults:
// - If ARHEB_DATA_DIR is not set and /data/arheb exists, use it for SQLite DB.
// - If ARHEB_JSON_DIR is not set and /data/arheb exists, use it for JSON files too.
const DEFAULT_RENDER_DATA_DIR = '/data/arheb';
if (!process.env.ARHEB_DATA_DIR && fs.existsSync(DEFAULT_RENDER_DATA_DIR)) {
  process.env.ARHEB_DATA_DIR = DEFAULT_RENDER_DATA_DIR;
}
if (!process.env.ARHEB_JSON_DIR && fs.existsSync(DEFAULT_RENDER_DATA_DIR)) {
  process.env.ARHEB_JSON_DIR = DEFAULT_RENDER_DATA_DIR;
}

const { ensurePersistentDirSeeded } = require('./config/jsonPaths');
ensurePersistentDirSeeded();

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 4000;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required to sign JWT tokens');
}

if (!FIREBASE_API_KEY) {
  console.warn(
    '[auth] FIREBASE_API_KEY not set — Firebase SMS OTP (/api/auth/register, verify-otp) and delete-user calls are disabled.',
  );
}

const app = express();
app.use(
  cors({
    origin: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition'],
  }),
);
app.use(express.json());

// Create HTTP server for Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  /** Friendlier behind Render / proxies (WS upgrade can be slow). */
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['polling', 'websocket'],
});
attachAdminDashboardNamespace(io, JWT_SECRET);

const dataDir = process.env.ARHEB_DATA_DIR
  ? (path.isAbsolute(process.env.ARHEB_DATA_DIR)
      ? process.env.ARHEB_DATA_DIR
      : path.resolve(process.cwd(), process.env.ARHEB_DATA_DIR))
  : path.resolve(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'auth.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phoneNumber TEXT UNIQUE NOT NULL,
    userId TEXT,
    firebaseUid TEXT,
    token TEXT,
    name TEXT,
    addressName TEXT,
    addressLong REAL,
    addressLat REAL,
    deleted INTEGER DEFAULT 0,
    deletedAt TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add new columns if they don't exist (for existing databases)
try { db.exec(`ALTER TABLE users ADD COLUMN userId TEXT`); } catch (e) { /* exists */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN name TEXT`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN addressName TEXT`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN addressLong REAL`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN addressLat REAL`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN type TEXT DEFAULT 'user'`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN addresses TEXT DEFAULT '[]'`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN fcmToken TEXT`);
} catch (e) {
  // Column already exists
}
try { db.exec(`ALTER TABLE users ADD COLUMN deleted INTEGER DEFAULT 0`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE users ADD COLUMN deletedAt TEXT`); } catch (e) { /* exists */ }
try { db.exec(`ALTER TABLE users ADD COLUMN isBlocked INTEGER DEFAULT 0`); } catch (e) { /* exists */ }

// Backfill userId for existing rows (default = phoneNumber)
try {
  db.prepare(`UPDATE users SET userId = phoneNumber WHERE userId IS NULL OR userId = ''`).run();
} catch (e) { /* ignore */ }

// Single orders + order_items table shared by: checkout (creates orders), admin (lists/updates), order tracking (WebSocket).
// There is only one orders table; all modules use this same db.
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    phoneNumber TEXT NOT NULL,
    name TEXT,
    addressName TEXT,
    addressLong REAL,
    addressLat REAL,
    discount REAL DEFAULT 0,
    deliveryFee REAL DEFAULT 0,
    totalAmount REAL NOT NULL,
    status TEXT DEFAULT 'Waiting confirmation',
    paymentType TEXT NOT NULL,
    promoCode TEXT,
    orderRating INTEGER DEFAULT 0,
    storeId TEXT,
    nearby TEXT,
    notes TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phoneNumber) REFERENCES users(phoneNumber)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId TEXT NOT NULL,
    productName TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
  );
`);

try {
  db.exec(`ALTER TABLE order_items ADD COLUMN selectedAddOns TEXT`);
} catch (e) {
  /* column exists */
}

// In-app notification history for customers (FCM payloads logged per user phone).
db.exec(`
  CREATE TABLE IF NOT EXISTS user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phoneNumber TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    imageUrl TEXT,
    dataJson TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_notifications_phone ON user_notifications(phoneNumber)`);
} catch (e) {
  /* ignore */
}

const { ensureStoreFcmTable } = require('./storeFcm');
ensureStoreFcmTable(db);

const upsertUser = db.prepare(`
  INSERT INTO users (phoneNumber, userId, firebaseUid, token, deleted, deletedAt)
  VALUES (@phoneNumber, @userId, @firebaseUid, @token, @deleted, @deletedAt)
  ON CONFLICT(phoneNumber) DO UPDATE SET
    userId = excluded.userId,
    firebaseUid = excluded.firebaseUid,
    token = excluded.token,
    deleted = excluded.deleted,
    deletedAt = excluded.deletedAt
`);

const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');
const findUserByFirebaseUid = db.prepare('SELECT * FROM users WHERE firebaseUid = ?');
const findDriverByMobile = db.prepare('SELECT * FROM drivers WHERE mobile = ?');

const {
  jordanMobileLookupKeys,
  normalizeJordanMobileKey,
} = require('./utils/jordanMobile');
const {
  isUserDeleted,
  isUserActive,
  findUserByPhoneFlexible: findUserByPhoneFlexibleShared,
  resolveAuthPhoneIdentity: resolveAuthPhoneIdentityShared,
  softDeleteUserRowsByPhone,
} = require('./utils/appUserLifecycle');
const {
  ensureWhatsappOtpTable,
  resolveOtpDestination,
  sendRegisterOtp,
  verifyRegisterOtp,
  sendCustomerWhatsappLoginOtp,
  verifyCustomerWhatsappLoginOtp,
  sendCustomerMetaWhatsappLoginOtp,
  verifyCustomerMetaWhatsappLoginOtp,
} = require('./utils/whatsappLoginOtp');

function findUserByPhoneFlexible(phone) {
  return findUserByPhoneFlexibleShared(db, findUserByPhone, phone);
}

function userRowHasProfileData(row) {
  if (!row) return false;
  if (row.name != null && String(row.name).trim() !== '') return true;
  try {
    const a = JSON.parse(row.addresses || '[]');
    if (Array.isArray(a) && a.length > 0) return true;
  } catch (e) {
    /* ignore */
  }
  return row.addressName != null || row.addressLong != null || row.addressLat != null;
}

function authRegistrationFlags(existingUser) {
  const active = isUserActive(existingUser);
  // A returning customer whose row was soft-deleted (e.g. during the Firebase→WhatsApp
  // transition) but still has a saved profile should NOT be treated as brand new.
  const returningWithData =
    Boolean(existingUser) && isUserDeleted(existingUser) && userRowHasProfileData(existingUser);
  return {
    alreadyRegistered: active || returningWithData,
    isNewUser: !(active || returningWithData),
  };
}

function retireDuplicatePhoneUserRows(canonicalPhoneKey) {
  const keys = jordanMobileLookupKeys(canonicalPhoneKey);
  for (const k of keys) {
    const u = findUserByPhone.get(k);
    if (!u || u.phoneNumber === canonicalPhoneKey || isUserDeleted(u)) continue;
    db.prepare(
      `UPDATE users SET deleted = 1, deletedAt = CURRENT_TIMESTAMP, token = NULL WHERE phoneNumber = ?`,
    ).run(u.phoneNumber);
  }
}

function resolveAuthPhoneIdentity(phoneInput) {
  return resolveAuthPhoneIdentityShared(db, findUserByPhone, phoneInput);
}

/**
 * Consolidate a customer's profile onto the canonical phone row so name/addresses survive
 * the Firebase→WhatsApp transition. Pulls data from rows stored under alternate phone
 * formats, and as a last resort recovers the address from the most recent order (orders
 * persist even when the saved profile was cleared). Non-destructive: only fills gaps.
 */
function mergeDuplicatePhoneProfilesIntoCanonical(canonicalPhone) {
  const canonicalRow = findUserByPhone.get(canonicalPhone);
  if (!canonicalRow) return;

  const keys = jordanMobileLookupKeys(canonicalPhone);
  const rows = [];
  const seen = new Set();
  for (const k of keys) {
    const u = findUserByPhone.get(k);
    if (u && !seen.has(u.phoneNumber)) {
      seen.add(u.phoneNumber);
      rows.push(u);
    }
  }

  const hasText = (v) => v != null && String(v).trim() !== '';
  const parseAddrs = (u) => {
    try {
      const a = JSON.parse(u.addresses || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  };
  const legacyAddr = (u) =>
    u.addressName != null || u.addressLong != null || u.addressLat != null
      ? [{ addressName: u.addressName || null, addressLong: u.addressLong ?? null, addressLat: u.addressLat ?? null }]
      : [];

  let mergedName = hasText(canonicalRow.name) ? canonicalRow.name : null;
  if (!mergedName) {
    for (const u of rows) {
      if (hasText(u.name)) {
        mergedName = u.name;
        break;
      }
    }
  }

  let mergedFcm = hasText(canonicalRow.fcmToken) ? canonicalRow.fcmToken : null;
  if (!mergedFcm) {
    for (const u of rows) {
      if (hasText(u.fcmToken)) {
        mergedFcm = u.fcmToken;
        break;
      }
    }
  }

  let mergedAddresses = parseAddrs(canonicalRow);
  if (mergedAddresses.length === 0) mergedAddresses = legacyAddr(canonicalRow);
  if (mergedAddresses.length === 0) {
    for (const u of rows) {
      const a = parseAddrs(u);
      if (a.length) {
        mergedAddresses = a;
        break;
      }
    }
  }
  if (mergedAddresses.length === 0) {
    for (const u of rows) {
      const a = legacyAddr(u);
      if (a.length) {
        mergedAddresses = a;
        break;
      }
    }
  }
  if (mergedAddresses.length === 0) {
    try {
      const placeholders = keys.map(() => '?').join(',');
      const order = db
        .prepare(
          `SELECT addressName, addressLong, addressLat FROM orders
           WHERE phoneNumber IN (${placeholders})
             AND (addressLong IS NOT NULL OR addressLat IS NOT NULL OR addressName IS NOT NULL)
           ORDER BY datetime(createdAt) DESC, id DESC LIMIT 1`,
        )
        .get(...keys);
      if (order && (order.addressLong != null || order.addressLat != null || hasText(order.addressName))) {
        mergedAddresses = [
          {
            addressName: order.addressName || null,
            addressLong: order.addressLong ?? null,
            addressLat: order.addressLat ?? null,
          },
        ];
      }
    } catch (e) {
      /* ignore */
    }
  }

  try {
    db.prepare(`UPDATE users SET name = ?, addresses = ?, fcmToken = ? WHERE phoneNumber = ?`).run(
      mergedName ?? null,
      JSON.stringify(mergedAddresses),
      mergedFcm ?? null,
      canonicalPhone,
    );
  } catch (e) {
    /* ignore */
  }
}

function findDriverByPhoneFlexible(phone) {
  const keys = jordanMobileLookupKeys(phone);
  for (const k of keys) {
    const driver = findDriverByMobile.get(k);
    if (driver && !driver.deleted) return driver;
  }
  return null;
}

ensureWhatsappOtpTable(db);

function maskPhoneForLog(phone) {
  const s = String(phone || '').trim();
  if (!s) return '-';
  if (s.length <= 4) return s;
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function summarizeTraceBody(body) {
  const src = body && typeof body === 'object' ? body : {};
  return {
    phoneNumber: src.phoneNumber ? maskPhoneForLog(src.phoneNumber) : undefined,
    mobile: src.mobile ? maskPhoneForLog(src.mobile) : undefined,
    hasIdToken: Boolean(src.idToken),
    hasSessionInfo: Boolean(src.sessionInfo),
    hasVerificationId: Boolean(src.verificationId),
    hasOtp: src.otp != null || src.otpCode != null,
    otpLength: src.otp != null ? String(src.otp).length : (src.otpCode != null ? String(src.otpCode).length : 0),
    hasRecaptchaToken: Boolean(src.recaptchaToken),
    hasCaptchaResponse: Boolean(src.captchaResponse),
    clientType: src.clientType || null,
  };
}

app.use((req, res, next) => {
  const traceable =
    req.path.startsWith('/api/auth/') ||
    req.path.startsWith('/api/driver/') ||
    req.path.startsWith('/api/profile');
  if (!traceable) return next();

  const startedAt = Date.now();
  console.log(`[trace:start] ${req.method} ${req.path}`, summarizeTraceBody(req.body));

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(`[trace:end] ${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms)`);
  });

  next();
});

// Fast health check for Render (and uptime pingers to keep the instance warm).
// Must respond instantly without touching the DB or external services.
app.get(['/healthz', '/health'], (req, res) => {
  res.status(200).json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'arheb-backend' });
});

const testClientDir = path.join(__dirname, '..', 'test-client');
if (fs.existsSync(testClientDir)) {
  app.use('/test-client', express.static(testClientDir));
}

const {
  ensurePlatformCheckoutFeesTable,
  syncPlatformCheckoutFeesFromStoreBulkPolicy,
  syncStoreListingDeliveryFeesFromBulkPolicy,
} = require('./utils/platformCheckoutFees');
try {
  ensurePlatformCheckoutFeesTable(db);
  const listingSync = syncStoreListingDeliveryFeesFromBulkPolicy();
  if (listingSync.updated > 0) {
    console.log(
      `[startup] synced store listing deliveryFee on ${listingSync.updated} store(s) from bulk checkout policy`,
    );
  }
  const platformSync = syncPlatformCheckoutFeesFromStoreBulkPolicy(db);
  if (platformSync.synced) {
    console.log(
      `[startup] synced App Info flatDeliveryFeeJod to ${platformSync.flatDeliveryFeeJod} from store bulk policy`,
    );
  }
} catch (e) {
  console.warn('[startup] checkout delivery fee sync skipped:', e.message);
}

attachCategoriesRoutes(app, db);
attachFoodTypesRoutes(app, db);
attachProductsRoutes(app, db);
attachHomeRoutes(app, db, JWT_SECRET);
attachStoresRoutes(app, db);
attachPopupRoutes(app);
attachSearchRoutes(app);
attachAdmin(app, db, JWT_SECRET, io);
attachDriverRoutes(app, db, JWT_SECRET, io);

function finalizePhoneAuthSession(firebasePhone, firebaseUid, verificationIdToken) {
  const identity = resolveAuthPhoneIdentity(firebasePhone);
  const existing = identity.existingUser;
  const phoneKey = identity.canonicalPhone;
  if (existing && existing.isBlocked) {
    const e = new Error('User is blocked');
    e.statusCode = 403;
    throw e;
  }
  // Reuse the existing identity so returning customers keep their saved profile and order
  // history, even if their row was soft-deleted during the Firebase→WhatsApp transition.
  const newUserId = existing?.userId || phoneKey;

  const token = jwt.sign(
    { phoneNumber: phoneKey, userId: newUserId },
    JWT_SECRET,
    { expiresIn: '7d' },
  );

  upsertUser.run({
    phoneNumber: phoneKey,
    userId: newUserId,
    firebaseUid,
    token,
    deleted: 0,
    deletedAt: null,
  });

  // Pull any name/addresses stored under alternate phone formats (or recoverable from past
  // orders) into the canonical row, then retire the duplicate alias rows. This replaces the
  // previous behavior that wiped the profile for soft-deleted rows and caused returning
  // customers to lose their saved addresses.
  mergeDuplicatePhoneProfilesIntoCanonical(phoneKey);
  retireDuplicatePhoneUserRows(phoneKey);

  return {
    success: true,
    token: `Bearer ${token}`,
    firebaseToken: verificationIdToken ?? null,
    phoneNumber: phoneKey,
    userId: newUserId,
  };
}

function attachDriverClaimsToSession(sessionBody, phoneNumber, verificationIdToken) {
  const driver = findDriverByPhoneFlexible(phoneNumber);
  if (!driver || driver.isBlocked) return sessionBody;

  const combinedToken = jwt.sign(
    {
      phoneNumber: sessionBody.phoneNumber,
      userId: sessionBody.userId,
      driverId: driver.id,
      mobile: driver.mobile,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );

  const d = { ...driver };
  delete d.licenseNumber;
  return {
    ...sessionBody,
    token: `Bearer ${combinedToken}`,
    firebaseToken: verificationIdToken ?? sessionBody.firebaseToken ?? null,
    driver: {
      id: String(d.id),
      name: d.name,
      photo: d.photo,
      mobile: d.mobile,
      phone: d.mobile,
      email: d.email,
      vehicleType: d.vehicleType,
      vehicleNumber: d.vehicleNumber,
      latitude: d.latitude,
      longitude: d.longitude,
      rating: d.rating ?? 5,
      isVerified: Boolean(d.isVerified),
    },
  };
}

function finalizeFirebaseIdentitySession(decoded, verificationIdToken) {
  const firebaseUid = decoded?.uid || null;
  const firebasePhone = decoded?.phone_number || null;
  if (firebasePhone) {
    const sessionBody = finalizePhoneAuthSession(firebasePhone, firebaseUid, verificationIdToken);
    return attachDriverClaimsToSession(sessionBody, firebasePhone, verificationIdToken);
  }
  if (!firebaseUid) {
    const e = new Error('Firebase token is missing uid');
    e.statusCode = 400;
    throw e;
  }

  const existingByUid = findUserByFirebaseUid.get(firebaseUid);
  const userKey = existingByUid?.phoneNumber || `firebase:${firebaseUid}`;
  if (existingByUid && existingByUid.isBlocked) {
    const e = new Error('User is blocked');
    e.statusCode = 403;
    throw e;
  }
  const newUserId =
    existingByUid && isUserDeleted(existingByUid)
      ? `u_${Date.now()}_${Math.random().toString(16).slice(2)}`
      : (existingByUid?.userId || userKey);

  const token = jwt.sign(
    { phoneNumber: userKey, userId: newUserId },
    JWT_SECRET,
    { expiresIn: '7d' },
  );

  upsertUser.run({
    phoneNumber: userKey,
    userId: newUserId,
    firebaseUid,
    token,
    deleted: 0,
    deletedAt: null,
  });

  return {
    success: true,
    token: `Bearer ${token}`,
    firebaseToken: verificationIdToken ?? null,
    phoneNumber: userKey,
    userId: newUserId,
  };
}

function extractFirebaseError(error) {
  const d = error?.response?.data;
  if (d?.error?.message) return d.error.message;
  if (typeof d?.error === 'string') return d.error;
  if (d?.error && typeof d.error === 'object' && d.error.message) return d.error.message;
  return error?.message || 'Unexpected Firebase error';
}

function hintForSendVerificationError(rawMessage) {
  const s = String(rawMessage || '');
  if (
    s.includes('MISSING_CLIENT_IDENTIFIER') ||
    s.includes('MISSING_CLIENT_ID') ||
    s.includes('CAPTCHA_CHECK_FAILED')
  ) {
    return (
      'Real phone numbers require app verification tokens (Firebase test numbers skip this). ' +
      'Recommended: complete phone sign-in on the device with Firebase Auth SDK, then call POST /api/auth/verify-firebase-token with the Firebase idToken. ' +
      'Alternative: send recaptchaToken or captchaResponse from the client to POST /api/auth/register (see Identity Toolkit sendVerificationCode).'
    );
  }
  return null;
}

async function sendFirebasePhoneOtp(phoneNumber, options = {}) {
  if (!FIREBASE_API_KEY) {
    const err = new Error('Firebase OTP is not configured (FIREBASE_API_KEY missing on server)');
    err.code = 'FIREBASE_NOT_CONFIGURED';
    throw err;
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${FIREBASE_API_KEY}`;
  const payload = { phoneNumber };
  if (options.recaptchaToken) payload.recaptchaToken = options.recaptchaToken;
  if (options.captchaResponse) payload.captchaResponse = options.captchaResponse;
  if (options.clientType) payload.clientType = options.clientType;

  const response = await axios.post(url, payload, { timeout: 15000 });
  return response.data.sessionInfo;
}

async function verifyFirebasePhoneOtp(sessionInfo, code) {
  if (!FIREBASE_API_KEY) {
    const err = new Error('Firebase OTP is not configured (FIREBASE_API_KEY missing on server)');
    err.code = 'FIREBASE_NOT_CONFIGURED';
    throw err;
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${FIREBASE_API_KEY}`;
  const response = await axios.post(url, { sessionInfo, code }, { timeout: 15000 });
  return response.data;
}

function authSendOtpPathLabel(req) {
  const p = String(req.path || '');
  if (p.includes('send-otp')) return 'send-otp→Firebase';
  if (p.includes('firebase')) return 'firebase register→Firebase';
  return 'register→Firebase';
}

function authLoginPathLabel(req) {
  const p = String(req.path || '');
  if (p.endsWith('/login')) return 'login→Firebase';
  if (p.includes('firebase')) return 'firebase verify→Firebase';
  return 'verify-otp→Firebase';
}

/** Send OTP — register, send-otp, and firebase/register aliases (Firebase Identity Toolkit SMS). */
async function handleAuthRegister(req, res) {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  const { recaptchaToken, captchaResponse, clientType } = body;
  console.log(`auth/send-otp hit (${authSendOtpPathLabel(req)})`, {
    phoneNumber: maskPhoneForLog(phoneNumber),
    hasRecaptchaToken: Boolean(recaptchaToken),
    hasCaptchaResponse: Boolean(captchaResponse),
    clientType: clientType || null,
  });
  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({ message: 'phoneNumber is required', case: 2 });
  }

  const normalizedPhone = String(phoneNumber).trim();
  const phoneKey = normalizeJordanMobileKey(normalizedPhone);
  const dest = resolveOtpDestination(normalizedPhone, phoneKey);
  const firebasePhone = dest?.e164 || (normalizedPhone.startsWith('+') ? normalizedPhone : null);
  if (!firebasePhone || firebasePhone.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ message: 'Invalid phone number', case: 2 });
  }

  const existingUser = resolveAuthPhoneIdentity(normalizedPhone).existingUser;
  if (existingUser && existingUser.isBlocked) {
    return res.status(403).json({ message: 'User is blocked', case: 2 });
  }

  try {
    const sessionInfo = await sendFirebasePhoneOtp(firebasePhone, {
      recaptchaToken,
      captchaResponse,
      clientType,
    });
    return res.status(200).json({
      message: 'OTP SENT SUCCESSFUL',
      case: 1,
      ...authRegistrationFlags(existingUser),
      sessionInfo,
      verificationId: sessionInfo,
      otpProvider: 'firebase',
    });
  } catch (error) {
    if (error.code === 'FIREBASE_NOT_CONFIGURED') {
      return res.status(503).json({ message: error.message, case: 2 });
    }
    const raw = extractFirebaseError(error);
    const hint = hintForSendVerificationError(raw);
    console.error('auth/register error:', raw);
    return res.status(500).json({
      message: hint ? `${raw}. ${hint}` : raw,
      case: 2,
      ...(hint && { firebaseHint: hint }),
    });
  }
}

app.post('/api/auth/register', handleAuthRegister);
app.post('/api/auth/send-otp', handleAuthRegister);
app.post('/api/auth/firebase/register', handleAuthRegister);

/** Live customer auth — /api/auth/twilio/* (Meta first, then Twilio WhatsApp + SMS fallback). */
async function handleTwilioAuthRegister(req, res) {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  console.log('auth/twilio/register hit', { phoneNumber: maskPhoneForLog(phoneNumber) });
  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({ message: 'phoneNumber is required', case: 2 });
  }

  const normalizedPhone = String(phoneNumber).trim();
  const { phoneKey, existingUser } = resolveAuthPhoneIdentity(normalizedPhone);
  if (!phoneKey || phoneKey.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ message: 'Invalid phone number', case: 2 });
  }

  if (existingUser && existingUser.isBlocked) {
    return res.status(403).json({ message: 'User is blocked', case: 2 });
  }

  try {
    const sent = await sendRegisterOtp(db, normalizedPhone, phoneKey);
    return res.status(200).json({
      message: 'OTP SENT SUCCESSFUL',
      case: 1,
      ...authRegistrationFlags(existingUser),
      sessionInfo: sent.sessionInfo,
      verificationId: sent.sessionInfo,
      otpProvider: 'twilio',
      otpChannel: sent.channel || null,
    });
  } catch (error) {
    if (error.code === 'RATE_LIMIT') {
      return res.status(429).json({
        message: error.message,
        case: 2,
        retryAfterSec: error.retryAfterSec,
      });
    }
    if (error.code === 'OTP_NOT_CONFIGURED') {
      return res.status(503).json({ message: error.message, case: 2 });
    }
    const raw = error.response?.data?.error?.message || error.message || 'OTP send failed';
    console.error('auth/twilio/register error:', raw, error.twilioErrorCode || '');
    return res.status(502).json({ message: String(raw), case: 2 });
  }
}

async function handleTwilioAuthVerifyOtp(req, res) {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  const sessionInfo = body.sessionInfo || body.verificationId;
  const otp = body.otp ?? body.otpCode;
  console.log('auth/twilio/verify-otp hit', {
    phoneNumber: maskPhoneForLog(phoneNumber),
    hasSessionInfo: Boolean(sessionInfo),
    otpLength: String(otp ?? '').length,
  });
  if (!phoneNumber || !sessionInfo || otp === undefined || otp === null || otp === '') {
    return res.status(400).json({
      success: false,
      message: 'phoneNumber, sessionInfo (or verificationId), and otp (or otpCode) are required',
      case: 2,
    });
  }

  const identity = resolveAuthPhoneIdentity(phoneNumber);
  if (!identity.phoneKey) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }

  try {
    await verifyRegisterOtp(db, identity.normalizedPhone, identity.phoneKey, sessionInfo, otp);
    const sessionBody = finalizePhoneAuthSession(
      identity.canonicalPhone,
      `twilio:${identity.phoneKey}`,
      null,
    );
    const withDriver = attachDriverClaimsToSession(sessionBody, identity.canonicalPhone, null);
    return res.status(200).json({
      ...withDriver,
      otpProvider: 'twilio',
      firebaseToken: null,
      case: 1,
      ...authRegistrationFlags(identity.existingUser),
    });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message, case: 2 });
    }
    if (error.code === 'INVALID_SESSION' || error.code === 'INVALID_OTP') {
      return res.status(401).json({ success: false, message: error.message, case: 2 });
    }
    console.error('auth/twilio/verify-otp error:', error?.message || error);
    return res.status(502).json({
      success: false,
      message: error.message || 'Verification failed',
      case: 2,
    });
  }
}

app.post('/api/auth/twilio/register', handleTwilioAuthRegister);
app.post('/api/auth/twilio/send-otp', handleTwilioAuthRegister);
app.post('/api/auth/twilio/verify-otp', handleTwilioAuthVerifyOtp);
app.post('/api/auth/twilio/login', handleTwilioAuthVerifyOtp);

function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'Missing Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const phone = payload?.phoneNumber;
    if (!phone) return res.status(401).json({ message: 'Invalid token' });
    const row = findUserByPhoneFlexible(phone);
    if (!row || isUserDeleted(row)) {
      return res.status(401).json({ message: 'User does not exist' });
    }
    if (row.isBlocked) {
      return res.status(403).json({ message: 'User is blocked' });
    }
    req.user = { phoneNumber: row.phoneNumber, userId: row.userId || row.phoneNumber };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

attachProfileRoutes(app, db, authenticateRequest);
attachWalletRoutes(app, db, authenticateRequest);
attachCheckoutRoutes(app, db, authenticateRequest);
attachPaymentRoutes(app, db, authenticateRequest, io);
attachContactRoutes(app, db, authenticateRequest);
attachArhebBoxRoutes(app, db, authenticateRequest, io);
attachOrderTrackingRoutes(io, app, db, authenticateRequest, JWT_SECRET);
attachDriverPresence(io, db, JWT_SECRET);
attachMerchantPresence(io, db, JWT_SECRET);

/**
 * Preferred for mobile apps: client completes Firebase Phone Auth on device, then exchanges idToken for your JWT.
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON (same Firebase project as the app).
 */
app.post('/api/auth/verify-firebase-token', async (req, res) => {
  const { idToken } = req.body || {};
  console.log('auth/verify-firebase-token hit', { hasIdToken: Boolean(idToken) });
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'idToken is required',
      case: 2,
    });
  }

  const auth = getAuth();
  if (!auth) {
    return res.status(503).json({
      success: false,
      message:
        'Firebase Admin is not configured (set FIREBASE_SERVICE_ACCOUNT_JSON for the same project as the client app)',
      case: 2,
    });
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const body = finalizeFirebaseIdentitySession(decoded, idToken);
    return res.status(200).json(body);
  } catch (error) {
    console.error('verify-firebase-token error:', error?.message, error?.code || '', error?.errorInfo?.code || '');
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message, case: 2 });
    }
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid id token',
      case: 2,
    });
  }
});

/**
 * WhatsApp OTP login (customer app): Twilio Verify WhatsApp (TWILIO_VERIFY_WHATSAPP_SERVICE_SID) if set; else Twilio Messaging Content template; else Meta.
 * Verify: https://www.twilio.com/docs/verify/whatsapp — optional TWILIO_VERIFY_PENDING_TTL_MS (stored session, default 10 min).
 */
app.post('/api/auth/whatsapp/send-code', async (req, res) => {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required', case: 2 });
  }
  const identity = resolveAuthPhoneIdentity(phoneNumber);
  if (!identity.phoneKey || identity.phoneKey.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }

  if (identity.existingUser && identity.existingUser.isBlocked) {
    return res.status(403).json({ success: false, message: 'User is blocked', case: 2 });
  }

  try {
    const sent = await sendCustomerWhatsappLoginOtp(db, identity.normalizedPhone, identity.phoneKey);
    const delivery = sent.channel === 'sms' ? 'sms' : 'whatsapp';
    return res.status(200).json({
      success: true,
      message: delivery === 'sms' ? 'OTP sent via SMS (Twilio Verify)' : 'OTP sent via WhatsApp',
      case: 1,
      ...authRegistrationFlags(identity.existingUser),
      verificationId: sent.sessionInfo,
      sessionInfo: sent.sessionInfo,
      expiresIn: sent.expiresInSec,
      channel: delivery,
      otpProvider: sent.otpProvider,
    });
  } catch (error) {
    if (error.code === 'RATE_LIMIT') {
      return res.status(429).json({
        success: false,
        message: error.message,
        case: 2,
        retryAfterSec: error.retryAfterSec,
      });
    }
    if (error.code === 'OTP_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, message: error.message, case: 2 });
    }
    const raw = error.response?.data?.error?.message || error.message || 'OTP send failed';
    console.error('whatsapp/send-code error:', raw);
    return res.status(502).json({ success: false, message: String(raw), case: 2 });
  }
});

app.post('/api/auth/whatsapp/verify-code', async (req, res) => {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  const verificationId = body.verificationId || body.sessionInfo;
  const otp = body.otp ?? body.otpCode;
  if (!phoneNumber || !verificationId || otp === undefined || otp === null || otp === '') {
    return res.status(400).json({
      success: false,
      message: 'phoneNumber, verificationId, and otp are required',
      case: 2,
    });
  }
  const identity = resolveAuthPhoneIdentity(phoneNumber);
  if (!identity.phoneKey) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }

  try {
    await verifyCustomerWhatsappLoginOtp(
      db,
      identity.normalizedPhone,
      identity.phoneKey,
      verificationId,
      otp,
    );
    const sessionBody = finalizePhoneAuthSession(
      identity.canonicalPhone,
      `whatsapp:${verificationId}`,
      null,
    );
    const withDriver = attachDriverClaimsToSession(sessionBody, identity.canonicalPhone, null);
    return res.status(200).json({
      ...withDriver,
      firebaseToken: null,
      otpProvider: 'whatsapp',
      case: 1,
      ...authRegistrationFlags(identity.existingUser),
    });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message, case: 2 });
    }
    if (error.code === 'INVALID_SESSION' || error.code === 'INVALID_OTP') {
      return res.status(401).json({ success: false, message: error.message, case: 2 });
    }
    console.error('whatsapp/verify-code error:', error?.message || error);
    return res.status(502).json({
      success: false,
      message: error.message || 'Verification failed',
      case: 2,
    });
  }
});

/** Meta Cloud API WhatsApp OTP (test) — never Twilio, never SMS. */
app.post('/api/auth/meta/whatsapp/send-code', async (req, res) => {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required', case: 2 });
  }
  const identity = resolveAuthPhoneIdentity(phoneNumber);
  if (!identity.phoneKey || identity.phoneKey.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }
  if (identity.existingUser && identity.existingUser.isBlocked) {
    return res.status(403).json({ success: false, message: 'User is blocked', case: 2 });
  }

  try {
    const sent = await sendCustomerMetaWhatsappLoginOtp(db, identity.normalizedPhone, identity.phoneKey);
    return res.status(200).json({
      success: true,
      message: 'OTP sent via WhatsApp (Meta Cloud API)',
      case: 1,
      ...authRegistrationFlags(identity.existingUser),
      verificationId: sent.sessionInfo,
      sessionInfo: sent.sessionInfo,
      expiresIn: sent.expiresInSec,
      channel: sent.channel,
      otpProvider: sent.otpProvider,
    });
  } catch (error) {
    if (error.code === 'RATE_LIMIT') {
      return res.status(429).json({
        success: false,
        message: error.message,
        case: 2,
        retryAfterSec: error.retryAfterSec,
      });
    }
    if (error.code === 'OTP_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, message: error.message, case: 2 });
    }
    const raw = error.message || 'Meta WhatsApp send failed';
    console.error('meta/whatsapp/send-code error:', raw, error.metaErrorCode || '');
    return res.status(502).json({ success: false, message: String(raw), case: 2 });
  }
});

app.post('/api/auth/meta/whatsapp/verify-code', async (req, res) => {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  const verificationId = body.verificationId || body.sessionInfo;
  const otp = body.otp ?? body.otpCode;
  if (!phoneNumber || !verificationId || otp === undefined || otp === null || otp === '') {
    return res.status(400).json({
      success: false,
      message: 'phoneNumber, verificationId, and otp are required',
      case: 2,
    });
  }
  const identity = resolveAuthPhoneIdentity(phoneNumber);
  if (!identity.phoneKey) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }

  try {
    await verifyCustomerMetaWhatsappLoginOtp(
      db,
      identity.normalizedPhone,
      identity.phoneKey,
      verificationId,
      otp,
    );
    const sessionBody = finalizePhoneAuthSession(
      identity.canonicalPhone,
      `meta:${verificationId}`,
      null,
    );
    const withDriver = attachDriverClaimsToSession(sessionBody, identity.canonicalPhone, null);
    return res.status(200).json({
      ...withDriver,
      firebaseToken: null,
      otpProvider: 'meta',
      case: 1,
      ...authRegistrationFlags(identity.existingUser),
    });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message, case: 2 });
    }
    if (error.code === 'INVALID_SESSION' || error.code === 'INVALID_OTP') {
      return res.status(401).json({ success: false, message: error.message, case: 2 });
    }
    console.error('meta/whatsapp/verify-code error:', error?.message || error);
    return res.status(502).json({
      success: false,
      message: error.message || 'Verification failed',
      case: 2,
    });
  }
});

/** Login — verify-otp, login, and firebase/verify-otp aliases (Firebase Identity Toolkit SMS). */
async function handleAuthVerifyOtp(req, res) {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  const sessionInfo = body.sessionInfo || body.verificationId;
  const otp = body.otp ?? body.otpCode;
  console.log(`auth/login hit (${authLoginPathLabel(req)})`, {
    phoneNumber: maskPhoneForLog(phoneNumber),
    hasSessionInfo: Boolean(sessionInfo),
    otpLength: String(otp ?? '').length,
  });
  if (!phoneNumber || !sessionInfo || otp === undefined || otp === null || otp === '') {
    return res.status(400).json({
      success: false,
      message: 'phoneNumber, sessionInfo (or verificationId), and otp (or otpCode) are required',
      case: 2,
    });
  }

  try {
    const verification = await verifyFirebasePhoneOtp(sessionInfo, otp);
    const firebasePhone = verification.phoneNumber || phoneNumber;
    const firebaseUid = verification.localId || verification?.userId || null;
    const sessionBody = finalizePhoneAuthSession(
      firebasePhone,
      firebaseUid,
      verification.idToken ?? null,
    );
    const withDriver = attachDriverClaimsToSession(
      sessionBody,
      firebasePhone,
      verification.idToken ?? null,
    );
    return res.status(200).json({ ...withDriver, otpProvider: 'firebase', case: 1 });
  } catch (error) {
    if (error.code === 'FIREBASE_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, message: error.message, case: 2 });
    }
    console.error('auth/login error:', extractFirebaseError(error));
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message, case: 2 });
    }
    return res.status(401).json({
      success: false,
      message: extractFirebaseError(error),
      case: 2,
    });
  }
}

app.post('/api/auth/verify-otp', handleAuthVerifyOtp);
app.post('/api/auth/login', handleAuthVerifyOtp);
app.post('/api/auth/firebase/verify-otp', handleAuthVerifyOtp);
app.post('/api/auth/firebase/login', handleAuthVerifyOtp);

async function deleteFirebaseUser(firebaseIdToken) {
  if (!FIREBASE_API_KEY) {
    throw new Error('Firebase is not configured (FIREBASE_API_KEY missing on server)');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`;
  await axios.post(url, { idToken: firebaseIdToken });
}

const softDeleteUserByPhone = db.prepare(
  `UPDATE users SET deleted = 1, deletedAt = CURRENT_TIMESTAMP, token = NULL WHERE phoneNumber = ?`,
);

// Soft delete user account (token only). On next login/signup, deleted users are treated as non-existent.
app.delete('/api/auth/user', authenticateRequest, async (req, res) => {
  try {
    const result = softDeleteUserRowsByPhone(
      db,
      findUserByPhone,
      softDeleteUserByPhone,
      req.user.phoneNumber,
    );
    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found or already deleted' });
    }
    return res.status(200).json({ success: true, message: 'Account deleted (soft)' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', case: 2 });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: 'Internal server error', case: 2 });
});

// Indexes for the hot order paths. Without these, every admin/driver/customer order query
// (and the per-order item lookups) does a full-table scan; since better-sqlite3 is synchronous
// that blocks the event loop and slows ALL requests. Run after route modules add their columns
// (storeId, driverId, etc.). Each is independent so a missing column can't block the others.
function ensureOrderPerformanceIndexes() {
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId)',
    'CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders(createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_orders_storeId ON orders(storeId)',
    'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
    'CREATE INDEX IF NOT EXISTS idx_orders_phoneNumber ON orders(phoneNumber)',
    'CREATE INDEX IF NOT EXISTS idx_orders_driverId ON orders(driverId)',
    'CREATE INDEX IF NOT EXISTS idx_driver_requests_order ON driver_requests(orderId, status)',
  ];
  for (const sql of statements) {
    try {
      db.exec(sql);
    } catch (e) {
      console.warn('[startup] index skipped:', sql, '-', e.message);
    }
  }
}
ensureOrderPerformanceIndexes();

httpServer.listen(PORT, () => {
  console.log(`Auth backend listening on http://localhost:${PORT}`);
  console.log(`WebSocket server ready for order tracking`);
});

