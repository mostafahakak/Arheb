'use strict';

/** Jordan national time (Aqaba, Amman, etc.) — no separate Aqaba offset. */
const JORDAN_IANA_TIMEZONE = 'Asia/Amman';

function getJordanMinutesNow() {
  const s = new Date().toLocaleTimeString('en-GB', {
    timeZone: JORDAN_IANA_TIMEZONE,
    hour12: false,
  });
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function parse24hClockToMinutes(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!parts) return null;
  const h = parseInt(parts[1], 10);
  const m = parseInt(parts[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function minutesTo24hClock(mins) {
  const h = Math.floor(((mins % 1440) + 1440) % 1440 / 60);
  const m = ((mins % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeMeridiem(v) {
  if (v == null || v === '') return null;
  const s = String(v)
    .trim()
    .toUpperCase()
    .replace(/\./g, '');
  if (s === 'AM' || s === 'A') return 'AM';
  if (s === 'PM' || s === 'P') return 'PM';
  return null;
}

/**
 * Parse dashboard time to 24h "HH:MM".
 * Supports "21:00", "9:00 PM", "9:00" + meridiem "PM" on the side.
 */
function parseFlexibleTimeTo24h(timeStr, meridiemHint) {
  const t = String(timeStr || '').trim();
  if (!t) return null;
  const mer = normalizeMeridiem(meridiemHint);
  const withAmpm = t.match(/^(\d{1,2}):(\d{2})\s*([AP]\.?M\.?)$/i);
  if (withAmpm) {
    let h = parseInt(withAmpm[1], 10);
    const m = parseInt(withAmpm[2], 10);
    const g = withAmpm[3].toUpperCase().replace(/\./g, '');
    const isPm = g.startsWith('P');
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    const hour24 = isPm ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
    return minutesTo24hClock(hour24 * 60 + m);
  }
  const plain = t.match(/^(\d{1,2}):(\d{2})$/);
  if (plain && mer) {
    const h = parseInt(plain[1], 10);
    const m = parseInt(plain[2], 10);
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    const hour24 = mer === 'PM' ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
    return minutesTo24hClock(hour24 * 60 + m);
  }
  if (plain) {
    const h = parseInt(plain[1], 10);
    const m = parseInt(plain[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return minutesTo24hClock(h * 60 + m);
  }
  return null;
}

function hasClosingConfigured(store) {
  if (!store) return false;
  const oh = store.openingHours;
  if (oh && typeof oh.close === 'string' && oh.close.trim() !== '') return true;
  if (typeof store.closingTime === 'string' && store.closingTime.trim() !== '') return true;
  return false;
}

/**
 * If no closing time is configured, treat schedule as 24/7 for this check.
 * Uses current clock in Jordan (Asia/Amman).
 */
function isWithinOpeningHoursStore(store) {
  if (!hasClosingConfigured(store)) return true;
  const oh = store.openingHours || {};
  const openStr = (oh.open && String(oh.open).trim()) || '09:00';
  const closeStr =
    (oh.close && String(oh.close).trim()) ||
    (typeof store.closingTime === 'string' && store.closingTime.trim()) ||
    null;
  if (!closeStr) return true;
  const openMin = parse24hClockToMinutes(openStr);
  const closeMin = parse24hClockToMinutes(closeStr);
  if (openMin == null || closeMin == null) return true;
  const now = getJordanMinutesNow();
  if (closeMin > openMin) return now >= openMin && now < closeMin;
  return now >= openMin || now < closeMin;
}

function formatMinutesTo12hDisplay(mins) {
  const total = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const mer = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const clock = `${h12}:${String(m).padStart(2, '0')}`;
  return { clock, meridiem: mer, display: `${clock} ${mer}` };
}

/** Attach 12h display + timezone metadata for API responses (canonical open/close stay 24h). */
function enrichOpeningHoursObject(oh) {
  const base = {
    timeZone: JORDAN_IANA_TIMEZONE,
    regionNote: 'Jordan (Asia/Amman, e.g. Aqaba)',
  };
  if (!oh || typeof oh !== 'object') {
    return base;
  }
  const openM = oh.open ? parse24hClockToMinutes(oh.open) : null;
  const closeM = oh.close ? parse24hClockToMinutes(oh.close) : null;
  const open12 = openM != null ? formatMinutesTo12hDisplay(openM) : null;
  const close12 = closeM != null ? formatMinutesTo12hDisplay(closeM) : null;
  return {
    ...oh,
    ...base,
    ...(open12 && { open12h: open12.display, openMeridiem: open12.meridiem }),
    ...(close12 && { close12h: close12.display, closeMeridiem: close12.meridiem }),
  };
}

function enrichStoreOpeningHours(store) {
  if (!store || typeof store !== 'object') return store;
  return {
    ...store,
    openingHours: enrichOpeningHoursObject(store.openingHours),
  };
}

/**
 * Merge dashboard payload into stored opening hours (24h canonical).
 * Omitting or clearing `close` removes closing → always-open hours behavior.
 */
function normalizeOpeningHoursFromBody(incoming, existingStore) {
  const prevOh =
    existingStore?.openingHours && typeof existingStore.openingHours === 'object'
      ? { ...existingStore.openingHours }
      : {};
  const inc = incoming && typeof incoming === 'object' ? { ...incoming } : {};

  const openMer = normalizeMeridiem(
    inc.openMeridiem ?? inc.openMer ?? prevOh.openMeridiem ?? prevOh.openMer,
  );
  const closeMer = normalizeMeridiem(
    inc.closeMeridiem ?? inc.closeMer ?? prevOh.closeMeridiem ?? prevOh.closeMer,
  );

  const openingHours = {};

  if ('open' in inc) {
    if (inc.open == null || inc.open === '') {
      openingHours.open = prevOh.open || '09:00';
    } else {
      const o = parseFlexibleTimeTo24h(String(inc.open).trim(), openMer);
      openingHours.open = o || prevOh.open || '09:00';
    }
  } else {
    openingHours.open = prevOh.open || '09:00';
  }

  let closingTime = existingStore?.closingTime ?? null;

  if ('close' in inc) {
    if (
      inc.close === null ||
      inc.close === undefined ||
      inc.close === '' ||
      (typeof inc.close === 'string' && !inc.close.trim())
    ) {
      closingTime = null;
    } else {
      const c = parseFlexibleTimeTo24h(String(inc.close).trim(), closeMer);
      if (c) {
        openingHours.close = c;
        closingTime = c;
      } else if (prevOh.close) {
        openingHours.close = prevOh.close;
        closingTime = existingStore?.closingTime ?? prevOh.close;
      }
    }
  } else if (prevOh.close) {
    openingHours.close = prevOh.close;
    if (closingTime == null || String(closingTime).trim() === '') {
      closingTime = prevOh.close;
    }
  }

  return { openingHours, closingTime };
}

module.exports = {
  JORDAN_IANA_TIMEZONE,
  getJordanMinutesNow,
  parse24hClockToMinutes,
  parseFlexibleTimeTo24h,
  hasClosingConfigured,
  isWithinOpeningHoursStore,
  enrichOpeningHoursObject,
  enrichStoreOpeningHours,
  normalizeOpeningHoursFromBody,
};
