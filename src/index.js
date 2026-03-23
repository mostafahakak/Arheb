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

dotenv.config();

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

const dataDir = path.resolve(__dirname, '..', 'data');
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

function extractFirebaseError(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'Unexpected Firebase error'
  );
}

async function sendPhoneOtp(phoneNumber, recaptchaToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${FIREBASE_API_KEY}`;
  const payload = { phoneNumber };
  if (recaptchaToken) {
    payload.recaptchaToken = recaptchaToken;
  }

  const response = await axios.post(url, payload, { timeout: 15000 });
  return response.data.sessionInfo;
}

async function verifyPhoneOtp(sessionInfo, code) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${FIREBASE_API_KEY}`;
  const response = await axios.post(url, { sessionInfo, code }, { timeout: 15000 });
  return response.data;
}

app.post('/api/auth/register', async (req, res) => {
  const { phoneNumber, recaptchaToken } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ message: 'phoneNumber is required', case: 2 });
  }

  try {
    const normalizedPhone = phoneNumber.trim();
    const existingUser = findUserByPhone.get(normalizedPhone);
    const sessionInfo = await sendPhoneOtp(normalizedPhone, recaptchaToken);
    return res.status(200).json({
      message: 'OTP SENT SUCCESSFUL',
      case: 1,
      alreadyRegistered: Boolean(existingUser && !existingUser.deleted),
      sessionInfo,
    });
  } catch (error) {
    return res.status(500).json({
      message: extractFirebaseError(error),
      case: 2,
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
    const row = findUserByPhone.get(phone);
    if (!row || row.deleted) {
      return res.status(401).json({ message: 'User does not exist' });
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

    const existing = findUserByPhone.get(firebasePhone);
    // If the user previously deleted the account, we "re-signup" by issuing a new userId and clearing old profile fields.
    const newUserId =
      existing && existing.deleted
        ? `u_${Date.now()}_${Math.random().toString(16).slice(2)}`
        : (existing?.userId || firebasePhone);

    const token = jwt.sign(
      { phoneNumber: firebasePhone, userId: newUserId },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    upsertUser.run({
      phoneNumber: firebasePhone,
      userId: newUserId,
      firebaseUid,
      token,
      deleted: 0,
      deletedAt: null,
    });

    if (existing && existing.deleted) {
      // Reset old profile data so the new account doesn't see previous data
      try {
        db.prepare(`UPDATE users SET name = NULL, addressName = NULL, addressLong = NULL, addressLat = NULL, addresses = '[]', fcmToken = NULL WHERE phoneNumber = ?`).run(firebasePhone);
      } catch (e) { /* ignore */ }
    }

    return res.status(200).json({
      success: true,
      token: `Bearer ${token}`,
      firebaseToken: verification.idToken ?? null,
      phoneNumber: firebasePhone,
      userId: newUserId,
    });
  } catch (error) {
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
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
  next();
});

httpServer.listen(PORT, () => {
  console.log(`Auth backend listening on http://localhost:${PORT}`);
  console.log(`WebSocket server ready for order tracking`);
});

