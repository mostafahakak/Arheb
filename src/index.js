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
const attachAdmin = require('./admin');
const attachPopupRoutes = require('./popup');
const attachArhebBoxRoutes = require('./arhebBox');
const attachSearchRoutes = require('./search');
const attachDriverRoutes = require('./driver');
const { getAuth } = require('./fcm');

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

if (!FIREBASE_API_KEY) {
  throw new Error('FIREBASE_API_KEY is required to send Firebase OTPs');
}

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required to sign JWT tokens');
}

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server for Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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

const { jordanMobileLookupKeys } = require('./utils/jordanMobile');

function findUserByPhoneFlexible(phone) {
  const keys = jordanMobileLookupKeys(phone);
  for (const k of keys) {
    const u = findUserByPhone.get(k);
    if (u) return u;
  }
  return null;
}

const testClientDir = path.join(__dirname, '..', 'test-client');
if (fs.existsSync(testClientDir)) {
  app.use('/test-client', express.static(testClientDir));
}

attachCategoriesRoutes(app, db);
attachProductsRoutes(app, db);
attachHomeRoutes(app, db, JWT_SECRET);
attachStoresRoutes(app, db);
attachPopupRoutes(app);
attachSearchRoutes(app);
attachAdmin(app, db, JWT_SECRET);
attachDriverRoutes(app, db, JWT_SECRET);

const findDriverByMobileStmt = db.prepare('SELECT * FROM drivers WHERE mobile = ?');
function findDriverByMobileFlexible(firebaseOrLocalPhone) {
  const keys = jordanMobileLookupKeys(firebaseOrLocalPhone);
  for (const k of keys) {
    const d = findDriverByMobileStmt.get(k);
    if (d && !d.deleted) return d;
  }
  return null;
}

function extractFirebaseError(error) {
  const d = error?.response?.data;
  if (d?.error?.message) return d.error.message;
  if (typeof d?.error === 'string') return d.error;
  if (d?.error && typeof d.error === 'object' && d.error.message) return d.error.message;
  return error?.message || 'Unexpected Firebase error';
}

/**
 * Human hint when Identity Toolkit rejects server-only sendVerificationCode (real numbers need client verification).
 */
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
    accountType: 'customer',
    token: `Bearer ${token}`,
    firebaseToken: verificationIdToken ?? null,
    phoneNumber: phoneKey,
    userId: newUserId,
  };
}

/** driver | customer | legacy (active customer first, else driver-only, else new customer — works without Flutter flags) */
function getAuthIntent(req) {
  const q = (req.query && String(req.query.intent || '').trim()) || '';
  const b = req.body || {};
  const fromBody = String(b.client || b.appRole || b.accountType || '').trim();
  const h = String(req.headers['x-arheb-client'] || '').trim().toLowerCase();
  const raw = String(q || fromBody || h || '').toLowerCase();
  if (raw === 'driver' || raw === 'driver_app') return 'driver';
  if (raw === 'customer' || raw === 'user' || raw === 'consumer' || raw === 'client') return 'customer';
  return 'legacy';
}

function buildDriverVerifyResponse(driver, firebasePhone, idToken) {
  const token = jwt.sign(
    { driverId: driver.id, mobile: driver.mobile },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
  const d = { ...driver };
  delete d.licenseNumber;
  return {
    success: true,
    accountType: 'driver',
    token: `Bearer ${token}`,
    userId: String(d.id),
    phoneNumber: firebasePhone,
    firebaseToken: idToken,
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

function exchangeFirebasePhoneForSession(req, res, firebasePhone, firebaseUid, idToken) {
  const intent = getAuthIntent(req);
  const driver = findDriverByMobileFlexible(firebasePhone);

  if (intent === 'driver') {
    if (!driver || driver.deleted) {
      return res.status(403).json({
        success: false,
        accountType: 'not_driver',
        message:
          'This phone number is not registered as a driver. Use the customer app to sign in, or ask an admin to add you as a driver.',
        case: 2,
      });
    }
    if (driver.isBlocked) {
      return res.status(403).json({
        success: false,
        accountType: 'driver',
        message: 'Account is blocked',
        case: 2,
      });
    }
    return res.status(200).json(buildDriverVerifyResponse(driver, firebasePhone, idToken));
  }

  if (intent === 'customer') {
    try {
      return res.status(200).json(finalizePhoneAuthSession(firebasePhone, firebaseUid, idToken));
    } catch (e) {
      if (e.statusCode === 403) {
        return res.status(403).json({ success: false, message: e.message, case: 2 });
      }
      return res.status(500).json({
        success: false,
        accountType: 'customer',
        message: e.message || 'Could not create session',
        case: 2,
      });
    }
  }

  // Legacy (default): shoppers get a user JWT if they already have an active users row; else driver-only accounts get driver JWT; else create customer.
  const existingUser = findUserByPhoneFlexible(firebasePhone);
  if (existingUser && !existingUser.deleted) {
    if (existingUser.isBlocked) {
      return res.status(403).json({
        success: false,
        accountType: 'customer',
        message: 'User is blocked',
        case: 2,
      });
    }
    try {
      return res.status(200).json(finalizePhoneAuthSession(firebasePhone, firebaseUid, idToken));
    } catch (e) {
      if (e.statusCode === 403) {
        return res.status(403).json({ success: false, message: e.message, case: 2 });
      }
      return res.status(500).json({
        success: false,
        accountType: 'customer',
        message: e.message || 'Could not create session',
        case: 2,
      });
    }
  }

  if (driver && !driver.deleted) {
    if (driver.isBlocked) {
      return res.status(403).json({
        success: false,
        accountType: 'driver',
        message: 'Account is blocked',
        case: 2,
      });
    }
    return res.status(200).json(buildDriverVerifyResponse(driver, firebasePhone, idToken));
  }

  try {
    return res.status(200).json(finalizePhoneAuthSession(firebasePhone, firebaseUid, idToken));
  } catch (e) {
    if (e.statusCode === 403) {
      return res.status(403).json({ success: false, message: e.message, case: 2 });
    }
    return res.status(500).json({
      success: false,
      accountType: 'customer',
      message: e.message || 'Could not create session',
      case: 2,
    });
  }
}

async function sendPhoneOtp(phoneNumber, options = {}) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${FIREBASE_API_KEY}`;
  const payload = { phoneNumber };
  if (options.recaptchaToken) payload.recaptchaToken = options.recaptchaToken;
  if (options.captchaResponse) payload.captchaResponse = options.captchaResponse;
  if (options.clientType) payload.clientType = options.clientType;

  const response = await axios.post(url, payload, { timeout: 15000 });
  return response.data.sessionInfo;
}

async function verifyPhoneOtp(sessionInfo, code) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${FIREBASE_API_KEY}`;
  const response = await axios.post(url, { sessionInfo, code }, { timeout: 15000 });
  return response.data;
}

app.post('/api/auth/register', async (req, res) => {
  const { phoneNumber, recaptchaToken, captchaResponse, clientType } = req.body || {};
  if (!phoneNumber) {
    return res.status(400).json({ message: 'phoneNumber is required', case: 2 });
  }

  try {
    const normalizedPhone = phoneNumber.trim();
    const existingUser = findUserByPhoneFlexible(normalizedPhone);
    const sessionInfo = await sendPhoneOtp(normalizedPhone, {
      recaptchaToken,
      captchaResponse,
      clientType,
    });
    return res.status(200).json({
      message: 'OTP SENT SUCCESSFUL',
      case: 1,
      alreadyRegistered: Boolean(existingUser && !existingUser.deleted),
      sessionInfo,
    });
  } catch (error) {
    const raw = extractFirebaseError(error);
    const hint = hintForSendVerificationError(raw);
    return res.status(500).json({
      message: hint ? `${raw}. ${hint}` : raw,
      case: 2,
      ...(hint && { firebaseHint: hint }),
    });
  }
});

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
attachContactRoutes(app, db, authenticateRequest);
attachArhebBoxRoutes(app, db, authenticateRequest);
attachOrderTrackingRoutes(io, app, db, authenticateRequest, JWT_SECRET);
attachDriverPresence(io, db, JWT_SECRET);

/**
 * Preferred for mobile apps: client completes Firebase Phone Auth on device, then exchanges idToken for your JWT.
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON (same Firebase project as the app).
 */
app.post('/api/auth/verify-firebase-token', async (req, res) => {
  const { idToken } = req.body || {};
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
    const firebasePhone = decoded.phone_number;
    if (!firebasePhone) {
      return res.status(400).json({
        success: false,
        message: 'ID token has no phone_number claim (sign in with Firebase phone auth)',
        case: 2,
      });
    }
    const firebaseUid = decoded.uid || null;
    return exchangeFirebasePhoneForSession(req, res, firebasePhone, firebaseUid, idToken);
  } catch (error) {
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

app.post('/api/auth/verify-otp', async (req, res) => {
  const { phoneNumber, sessionInfo, otp } = req.body;
  if (!phoneNumber || !sessionInfo || !otp) {
    return res.status(400).json({
      success: false,
      message: 'phoneNumber, sessionInfo, and otp are required',
    });
  }

  try {
    const verification = await verifyPhoneOtp(sessionInfo, otp);
    const firebasePhone = verification.phoneNumber || phoneNumber;
    const firebaseUid = verification.localId || verification?.userId || null;
    const vToken = verification.idToken ?? null;
    return exchangeFirebasePhoneForSession(req, res, firebasePhone, firebaseUid, vToken);
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(401).json({
      success: false,
      message: extractFirebaseError(error),
    });
  }
});

async function deleteFirebaseUser(firebaseIdToken) {
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

