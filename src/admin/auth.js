const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signAdminToken(payload, JWT_SECRET) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
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
