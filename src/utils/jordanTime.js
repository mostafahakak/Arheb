/**
 * Display times in Jordan (Asia/Amman) — Aqaba uses the same timezone as the kingdom.
 */

const JORDAN_IANA_TIMEZONE = 'Asia/Amman';

/**
 * @param {string|number|Date|null|undefined} value - SQLite/ISO datetime
 * @returns {string|null} e.g. "03/04/2026, 14:30:00" in Amman, or null if invalid
 */
function formatJordanDateTime(value) {
  if (value == null || value === '') return null;
  const raw = typeof value === 'string' ? value.trim().replace(' ', 'T') : value;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: JORDAN_IANA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * @param {object} obj
 * @param {string[]} keys - e.g. ['createdAt']
 */
function enrichWithJordanTime(obj, keys = ['createdAt']) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of keys) {
    if (out[k] != null) {
      out[`${k}Jordan`] = formatJordanDateTime(out[k]);
    }
  }
  return out;
}

module.exports = {
  JORDAN_IANA_TIMEZONE,
  formatJordanDateTime,
  enrichWithJordanTime,
};
