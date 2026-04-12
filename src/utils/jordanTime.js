/**
 * Display times in Jordan (Asia/Amman) — Aqaba uses the same timezone as the kingdom.
 */

const JORDAN_IANA_TIMEZONE = 'Asia/Amman';

/**
 * Parse timestamps for Jordan display.
 * SQLite `CURRENT_TIMESTAMP` is UTC but stored **without** a timezone (`YYYY-MM-DD HH:MM:SS`).
 * `new Date(that)` in a browser uses **local** time, which shifts the instant by ~3h vs Amman expectations.
 * Naive date-times are therefore interpreted as **UTC**; values that already include `Z` or `±hh:mm` are unchanged.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {Date|null}
 */
function parseInstantForJordan(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  let s = String(value).trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (/[zZ]$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/.test(s)) {
    const d = new Date(`${s}Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * @param {string|number|Date|null|undefined} value - SQLite/ISO datetime
 * @returns {string|null} e.g. "03/04/2026, 14:30:00" in Amman, or null if invalid
 */
function formatJordanDateTime(value) {
  const d = parseInstantForJordan(value);
  if (!d) return null;
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
  parseInstantForJordan,
  formatJordanDateTime,
  enrichWithJordanTime,
};
