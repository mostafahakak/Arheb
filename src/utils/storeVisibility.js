/** Current time in Jordan (Asia/Amman) as minutes since midnight (0-1439). */
function getJordanMinutesNow() {
  const s = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Amman', hour12: false });
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Parse "HH:MM" or "HH:mm" to minutes since midnight. Returns 0 if invalid. */
function parseTimeToMinutes(str) {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!parts) return 0;
  const h = parseInt(parts[1], 10);
  const m = parseInt(parts[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return 0;
  return h * 60 + m;
}

/** True if current Jordan time is within store opening hours (openingHours.open / .close or closingTime). */
function isWithinOpeningHours(store) {
  const openStr = (store.openingHours && store.openingHours.open) || '09:00';
  const closeStr = (store.openingHours && store.openingHours.close) || store.closingTime || '23:00';
  const openMin = parseTimeToMinutes(openStr);
  const closeMin = parseTimeToMinutes(closeStr);
  const now = getJordanMinutesNow();
  if (closeMin > openMin) return now >= openMin && now < closeMin;
  return now >= openMin || now < closeMin;
}

/**
 * Store should appear in customer-facing lists and product APIs:
 * not paused, not blocked, admin toggle isOpen !== false, and within Jordan opening hours.
 */
function isStoreVisibleToCustomers(store) {
  if (!store || store.paused === true || store.blocked === true) return false;
  if (store.isOpen === false) return false;
  return isWithinOpeningHours(store);
}

module.exports = {
  getJordanMinutesNow,
  parseTimeToMinutes,
  isWithinOpeningHours,
  isStoreVisibleToCustomers,
};
