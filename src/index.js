const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const attachCategoriesRoutes = require('./categories');
const attachProductsRoutes = require('./products');
const attachHomeRoutes = require('./home');
const attachStoresRoutes = require('./stores');

dotenv.config();

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
app.use(express.json());

const dataDir = path.resolve(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'auth.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phoneNumber TEXT UNIQUE NOT NULL,
    firebaseUid TEXT,
    token TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const upsertUser = db.prepare(`
  INSERT INTO users (phoneNumber, firebaseUid, token)
  VALUES (@phoneNumber, @firebaseUid, @token)
  ON CONFLICT(phoneNumber) DO UPDATE SET
    firebaseUid = excluded.firebaseUid,
    token = excluded.token
`);

const findUserByPhone = db.prepare('SELECT * FROM users WHERE phoneNumber = ?');

const testClientDir = path.join(__dirname, '..', 'test-client');
if (fs.existsSync(testClientDir)) {
  app.use('/test-client', express.static(testClientDir));
}

attachCategoriesRoutes(app, db);
attachProductsRoutes(app, db);
attachHomeRoutes(app, db);
attachStoresRoutes(app, db);

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

  const normalizedPhone = phoneNumber.trim();
  const existingUser = findUserByPhone.get(normalizedPhone);

  if (existingUser) {
    return res
      .status(200)
      .json({ message: 'Phone number already exist try Login', case: 0 });
  }

  try {
    const sessionInfo = await sendPhoneOtp(normalizedPhone, recaptchaToken);
    return res.status(200).json({
      message: 'OTP SENT SUCCESSFUL',
      case: 1,
      sessionInfo,
    });
  } catch (error) {
    return res.status(500).json({
      message: extractFirebaseError(error),
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
    const token = jwt.sign({ phoneNumber: firebasePhone }, JWT_SECRET, {
      expiresIn: '7d',
    });

    upsertUser.run({
      phoneNumber: firebasePhone,
      firebaseUid,
      token,
    });

    return res.status(200).json({
      success: true,
      token: `Bearer ${token}`,
      phoneNumber: firebasePhone,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: extractFirebaseError(error),
    });
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

app.listen(PORT, () => {
  console.log(`Auth backend listening on http://localhost:${PORT}`);
});

