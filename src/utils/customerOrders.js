'use strict';

const { jordanMobileLookupKeys } = require('./jordanMobile');

/** All phone/userId variants that identify the same customer (Jordan formats). */
function customerLookupKeys(userId, phoneNumber) {
  const keys = new Set();
  for (const src of [userId, phoneNumber]) {
    if (src == null || String(src).trim() === '') continue;
    const s = String(src).trim();
    keys.add(s);
    for (const k of jordanMobileLookupKeys(s)) keys.add(k);
  }
  return [...keys];
}

function customerOwnsOrder(order, userId, phoneNumber) {
  if (!order) return false;
  const keys = new Set(customerLookupKeys(userId, phoneNumber));
  const candidates = new Set();
  if (order.userId != null && String(order.userId).trim()) {
    candidates.add(String(order.userId).trim());
    for (const k of jordanMobileLookupKeys(order.userId)) candidates.add(k);
  }
  if (order.phoneNumber != null && String(order.phoneNumber).trim()) {
    candidates.add(String(order.phoneNumber).trim());
    for (const k of jordanMobileLookupKeys(order.phoneNumber)) candidates.add(k);
  }
  for (const c of candidates) {
    if (keys.has(c)) return true;
  }
  return false;
}

function customerOwnsArhebBox(row, userId, phoneNumber) {
  if (!row) return false;
  const keys = new Set(customerLookupKeys(userId, phoneNumber));
  if (row.phoneNumber == null || String(row.phoneNumber).trim() === '') return false;
  const candidates = new Set([String(row.phoneNumber).trim()]);
  for (const k of jordanMobileLookupKeys(row.phoneNumber)) candidates.add(k);
  for (const c of candidates) {
    if (keys.has(c)) return true;
  }
  return false;
}

function loadStoreOrdersForCustomer(db, userId, phoneNumber) {
  const keys = customerLookupKeys(userId, phoneNumber);
  if (!keys.length) return [];
  const conditions = [];
  const params = [];
  for (const k of keys) {
    conditions.push('phoneNumber = ?');
    params.push(k);
    conditions.push('userId = ?');
    params.push(k);
  }
  const sql = `SELECT * FROM orders WHERE (${conditions.join(' OR ')}) ORDER BY datetime(COALESCE(createdAt, '1970-01-01')) DESC, id DESC`;
  return db.prepare(sql).all(...params);
}

function loadArhebBoxForCustomer(db, userId, phoneNumber) {
  const keys = customerLookupKeys(userId, phoneNumber);
  if (!keys.length) return [];
  const conditions = keys.map(() => 'phoneNumber = ?').join(' OR ');
  try {
    return db
      .prepare(
        `SELECT * FROM arheb_box_requests WHERE (${conditions}) ORDER BY datetime(COALESCE(createdAt, '1970-01-01')) DESC, id DESC`,
      )
      .all(...keys);
  } catch (e) {
    if (e.message && e.message.includes('no such table')) return [];
    throw e;
  }
}

function normalizeOrderStatusKey(status) {
  return String(status || '').trim().toLowerCase();
}

function isTerminalOrderStatus(status) {
  const s = normalizeOrderStatusKey(status);
  return s === 'delivered' || s === 'cancelled' || s.includes('payment rejected');
}

function isActiveOrderStatus(status) {
  return !isTerminalOrderStatus(status);
}

module.exports = {
  customerLookupKeys,
  customerOwnsOrder,
  customerOwnsArhebBox,
  loadStoreOrdersForCustomer,
  loadArhebBoxForCustomer,
  isTerminalOrderStatus,
  isActiveOrderStatus,
};
