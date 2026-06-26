const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;
// Admin dashboard session token lifetime. Was 7d, which logged admins out weekly (no refresh flow).
const ADMIN_TOKEN_TTL = process.env.APP_TOKEN_TTL || '365d';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signAdminToken(payload, JWT_SECRET) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ADMIN_TOKEN_TTL });
}

function verifyAdminToken(token, JWT_SECRET) {
  try {
    const clean = (token || '').replace('Bearer ', '').trim();
    return jwt.verify(clean, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  signAdminToken,
  verifyAdminToken,
};
