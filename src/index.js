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
const attachProductsRoutes = require('./products');
const attachHomeRoutes = require('./home');
const attachStoresRoutes = require('./stores');
const attachProfileRoutes = require('./profile');
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
    '[auth] FIREBASE_API_KEY not set — Firebase Admin delete-user calls are disabled. Phone OTP login uses Twilio on /api/auth/register + /api/auth/verify-otp (and /login aliases).',
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
  ensureWhatsappOtpTable,
  sendRegisterOtp,
  verifyRegisterOtp,
  sendCustomerWhatsappLoginOtp,
  verifyCustomerWhatsappLoginOtp,
  isTwilioOtpConfigured,
} = require('./utils/whatsappLoginOtp');

function findUserByPhoneFlexible(phone) {
  const keys = jordanMobileLookupKeys(phone);
  for (const k of keys) {
    const u = findUserByPhone.get(k);
    if (u) return u;
  }
  return null;
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
attachProductsRoutes(app, db);
attachHomeRoutes(app, db, JWT_SECRET);
attachStoresRoutes(app, db);
attachPopupRoutes(app);
attachSearchRoutes(app);
attachAdmin(app, db, JWT_SECRET, io);
attachDriverRoutes(app, db, JWT_SECRET, io);

function finalizePhoneAuthSession(firebasePhone, firebaseUid, verificationIdToken) {
  const existing = findUserByPhoneFlexible(firebasePhone);
  const phoneKey = existing?.phoneNumber ?? firebasePhone;
  if (existing && existing.isBlocked) {
    const e = new Error('User is blocked');
    e.statusCode = 403;
    throw e;
  }
  const newUserId =
    existing && existing.deleted
      ? `u_${Date.now()}_${Math.random().toString(16).slice(2)}`
      : (existing?.userId || phoneKey);

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

  if (existing && existing.deleted) {
    try {
      db.prepare(
        `UPDATE users SET name = NULL, addressName = NULL, addressLong = NULL, addressLat = NULL, addresses = '[]', fcmToken = NULL WHERE phoneNumber = ?`,
      ).run(phoneKey);
    } catch (e) {
      /* ignore */
    }
  }

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
    existingByUid && existingByUid.deleted
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

function authSendOtpPathLabel(req) {
  const p = String(req.path || '');
  if (p.includes('send-otp')) return 'send-otp→Twilio';
  if (p.includes('firebase')) return 'firebase register→Twilio';
  return 'register→Twilio';
}

function authLoginPathLabel(req) {
  const p = String(req.path || '');
  if (p.endsWith('/login')) return 'login→Twilio';
  if (p.includes('firebase')) return 'firebase verify→Twilio';
  return 'verify-otp→Twilio';
}

/** Send OTP — register, send-otp, and firebase/register aliases (Twilio Verify). */
async function handleAuthRegister(req, res) {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  console.log(`auth/send-otp hit (${authSendOtpPathLabel(req)})`, {
    phoneNumber: maskPhoneForLog(phoneNumber),
  });
  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({ message: 'phoneNumber is required', case: 2 });
  }

  const phoneKey = normalizeJordanMobileKey(phoneNumber);
  if (!phoneKey || phoneKey.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ message: 'Invalid phone number', case: 2 });
  }

  const existingUser = findUserByPhoneFlexible(phoneKey);
  if (existingUser && existingUser.isBlocked) {
    return res.status(403).json({ message: 'User is blocked', case: 2 });
  }

  try {
    const sent = await sendRegisterOtp(db, phoneNumber, phoneKey);
    return res.status(200).json({
      message: 'OTP SENT SUCCESSFUL',
      case: 1,
      alreadyRegistered: Boolean(existingUser && !existingUser.deleted),
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
    console.error('auth/send-otp error:', raw);
    return res.status(502).json({ message: String(raw), case: 2 });
  }
}

app.post('/api/auth/register', handleAuthRegister);
app.post('/api/auth/send-otp', handleAuthRegister);
app.post('/api/auth/firebase/register', handleAuthRegister);

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
    if (!row || row.deleted) {
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
attachCheckoutRoutes(app, db, authenticateRequest);
attachPaymentRoutes(app, db, authenticateRequest, io);
attachContactRoutes(app, db, authenticateRequest);
attachArhebBoxRoutes(app, db, authenticateRequest, io);
attachOrderTrackingRoutes(io, app, db, authenticateRequest, JWT_SECRET);
attachDriverPresence(io, db, JWT_SECRET);
attachMerchantPresence(io, db, JWT_SECRET);

/**
 * Exchange Firebase idToken for Arheb JWT (non-phone Firebase sign-in only when Twilio OTP is enabled).
 * Phone OTP login must use POST /api/auth/verify-otp or POST /api/auth/login (Twilio).
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
    if (isTwilioOtpConfigured() && decoded.phone_number) {
      return res.status(410).json({
        success: false,
        message:
          'Firebase phone OTP login is disabled. Use POST /api/auth/register (or /api/auth/send-otp) then POST /api/auth/verify-otp (or /api/auth/login) with Twilio OTP.',
        case: 2,
        otpProvider: 'twilio',
      });
    }
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
 * WhatsApp OTP login (customer app): Twilio Verify WhatsApp (TWILIO_VERIFY_SERVICE_SID) if set; else Twilio Messaging Content template; else Meta.
 * Verify: https://www.twilio.com/docs/verify/whatsapp — optional TWILIO_VERIFY_PENDING_TTL_MS (stored session, default 10 min).
 */
app.post('/api/auth/whatsapp/send-code', async (req, res) => {
  const body = req.body || {};
  const phoneNumber = body.phoneNumber || body.mobile;
  if (!phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required', case: 2 });
  }
  const phoneKey = normalizeJordanMobileKey(phoneNumber);
  if (!phoneKey || phoneKey.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }

  const existingUser = findUserByPhoneFlexible(phoneKey);
  if (existingUser && existingUser.isBlocked) {
    return res.status(403).json({ success: false, message: 'User is blocked', case: 2 });
  }

  try {
    const sent = await sendCustomerWhatsappLoginOtp(db, phoneNumber, phoneKey);
    const delivery = sent.channel === 'sms' ? 'sms' : 'whatsapp';
    return res.status(200).json({
      success: true,
      message: delivery === 'sms' ? 'OTP sent via SMS (Twilio Verify)' : 'OTP sent via WhatsApp',
      case: 1,
      alreadyRegistered: Boolean(existingUser && !existingUser.deleted),
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
  const phoneKey = normalizeJordanMobileKey(phoneNumber);
  if (!phoneKey) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }

  try {
    await verifyCustomerWhatsappLoginOtp(db, phoneNumber, phoneKey, verificationId, otp);
    const sessionBody = finalizePhoneAuthSession(phoneKey, `twilio:${verificationId}`, null);
    const withDriver = attachDriverClaimsToSession(sessionBody, phoneKey, null);
    return res.status(200).json({ ...withDriver, otpProvider: 'twilio', firebaseToken: null });
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

/** Login — verify-otp, login, and firebase/verify-otp aliases (Twilio Verify). */
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

  const phoneKey = normalizeJordanMobileKey(phoneNumber);
  if (!phoneKey) {
    return res.status(400).json({ success: false, message: 'Invalid phone number', case: 2 });
  }

  try {
    await verifyRegisterOtp(db, phoneNumber, phoneKey, sessionInfo, otp);
    const sessionBody = finalizePhoneAuthSession(phoneKey, `twilio:${phoneKey}`, null);
    const withDriver = attachDriverClaimsToSession(sessionBody, phoneKey, null);
    return res.status(200).json({ ...withDriver, otpProvider: 'twilio', firebaseToken: null, case: 1 });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, message: error.message, case: 2 });
    }
    if (error.code === 'INVALID_SESSION' || error.code === 'INVALID_OTP') {
      return res.status(401).json({ success: false, message: error.message, case: 2 });
    }
    console.error('auth/login error:', error?.message || error);
    return res.status(502).json({
      success: false,
      message: error.message || 'Verification failed',
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

// Soft delete user account (token only). On next login/signup, deleted users are treated as non-existent.
app.delete('/api/auth/user', authenticateRequest, async (req, res) => {
  const phone = req.user.phoneNumber;
  try {
    db.prepare(`UPDATE users SET deleted = 1, deletedAt = CURRENT_TIMESTAMP, token = NULL WHERE phoneNumber = ?`).run(phone);
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

httpServer.listen(PORT, () => {
  console.log(`Auth backend listening on http://localhost:${PORT}`);
  console.log(`WebSocket server ready for order tracking`);
});

