'use strict';

const { jordanMobileLookupKeys } = require('./jordanMobile');

function isUserDeleted(row) {
  if (!row) return false;
  const d = row.deleted;
  return d === 1 || d === true || String(d) === '1';
}

function isUserActive(row) {
  return Boolean(row && !isUserDeleted(row));
}

function pickCanonicalUserRow(matches) {
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const active = matches.filter((u) => isUserActive(u));
  const pool = active.length ? active : matches;
  pool.sort((a, b) => {
    const score = (u) => {
      if (String(u.phoneNumber).startsWith('+962')) return 0;
      if (String(u.phoneNumber).startsWith('+')) return 1;
      if (String(u.phoneNumber).startsWith('0')) return 2;
      return 3;
    };
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  return pool[0];
}

function findUserByPhoneFlexible(db, findUserByPhoneStmt, phone) {
  const keys = jordanMobileLookupKeys(phone);
  const seen = new Set();
  const matches = [];
  for (const k of keys) {
    const u = findUserByPhoneStmt.get(k);
    if (u && !seen.has(u.phoneNumber)) {
      seen.add(u.phoneNumber);
      matches.push(u);
    }
  }
  return pickCanonicalUserRow(matches);
}

function softDeleteUserRowsByPhone(db, findUserByPhoneStmt, softDeleteStmt, phone) {
  const primary = findUserByPhoneFlexible(db, findUserByPhoneStmt, phone);
  if (!primary || isUserDeleted(primary)) return null;
  const keys = [
    ...new Set([...jordanMobileLookupKeys(primary.phoneNumber), primary.phoneNumber].filter(Boolean)),
  ];
  const deletedPhones = [];
  for (const k of keys) {
    const u = findUserByPhoneStmt.get(k);
    if (u && !isUserDeleted(u)) {
      softDeleteStmt.run(u.phoneNumber);
      deletedPhones.push(u.phoneNumber);
    }
  }
  return { primary, deletedPhones };
}

function resolveAuthPhoneIdentity(db, findUserByPhoneStmt, phoneInput) {
  const { normalizeJordanMobileKey, jordanMobileToE164 } = require('./jordanMobile');
  const normalizedPhone = String(phoneInput || '').trim();
  const phoneKey = normalizeJordanMobileKey(normalizedPhone);
  const keys = jordanMobileLookupKeys(normalizedPhone);
  const seen = new Set();
  const matches = [];
  for (const k of keys) {
    const u = findUserByPhoneStmt.get(k);
    if (u && !seen.has(u.phoneNumber)) {
      seen.add(u.phoneNumber);
      matches.push(u);
    }
  }

  const activeMatches = matches.filter((u) => isUserActive(u));
  const deletedMatches = matches.filter((u) => isUserDeleted(u));
  let existingUser = pickCanonicalUserRow(matches);

  // Stray active alias row (e.g. 079…) left after soft-deleting canonical (+962…) profile.
  if (activeMatches.length > 0 && deletedMatches.length > 0) {
    const canonicalDeleted = pickCanonicalUserRow(deletedMatches);
    if (
      canonicalDeleted &&
      activeMatches.every((u) => u.phoneNumber !== canonicalDeleted.phoneNumber)
    ) {
      existingUser = canonicalDeleted;
    }
  }

  const canonicalPhone =
    existingUser?.phoneNumber ?? jordanMobileToE164(normalizedPhone) ?? phoneKey;
  const alreadyRegistered = isUserActive(existingUser);
  return { normalizedPhone, phoneKey, canonicalPhone, existingUser, alreadyRegistered };
}

module.exports = {
  isUserDeleted,
  isUserActive,
  pickCanonicalUserRow,
  findUserByPhoneFlexible,
  softDeleteUserRowsByPhone,
  resolveAuthPhoneIdentity,
};
