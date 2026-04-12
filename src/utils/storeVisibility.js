const fs = require('fs');
const { getJsonPath } = require('../config/jsonPaths');
const {
  JORDAN_IANA_TIMEZONE,
  getJordanMinutesNow,
  parse24hClockToMinutes,
  isWithinOpeningHoursStore,
} = require('./openingHoursJordan');

/** @deprecated use parse24hClockToMinutes from openingHoursJordan; kept for callers */
function parseTimeToMinutes(str) {
  const m = parse24hClockToMinutes(str);
  return m == null ? 0 : m;
}

function isWithinOpeningHours(store) {
  return isWithinOpeningHoursStore(store);
}

/**
 * Store should appear in customer-facing lists and product APIs:
 * not paused, not blocked, admin toggle isOpen !== false, and within Jordan (Asia/Amman) hours when a closing time exists.
 */
function isStoreVisibleToCustomers(store) {
  if (!store || store.paused === true || store.blocked === true) return false;
  if (store.isOpen === false) return false;
  return isWithinOpeningHours(store);
}

/**
 * Listed in public store browse (GET /api/stores, etc.): must be open and visible.
 * Blocked, paused, closed (isOpen=false), hidden, and outside opening hours are all excluded.
 */
function isStoreListedForCustomerBrowse(store) {
  if (!store || store.blocked === true) return false;
  if (store.hiddenFromCustomers === true) return false;
  if (store.paused === true) return false;
  if (store.isOpen === false) return false;
  return isWithinOpeningHours(store);
}

/** Admin dashboard bucket: open (customer-visible) → paused → closed. */
function getAdminStoreDashboardBucket(store) {
  if (!store) return 'closed';
  if (store.paused === true) return 'paused';
  if (isStoreVisibleToCustomers(store)) return 'open';
  return 'closed';
}

/**
 * Customer API `isOpen`: false when blocked, paused, merchant closed (isOpen=false), or outside Jordan hours.
 * Aligns with {@link isStoreVisibleToCustomers} so apps can rely on a single flag.
 */
function customerFacingIsOpen(store) {
  return isStoreVisibleToCustomers(store);
}

/** Raw stores from `stores_listing_response.json` keyed by id (for product nested `store` enrichment). */
function loadStoresByIdMap() {
  try {
    const raw = fs.readFileSync(getJsonPath('stores_listing_response.json'), 'utf-8');
    const stores = JSON.parse(raw)?.data?.stores ?? [];
    const map = Object.create(null);
    for (const s of stores) {
      if (s && s.id != null) map[String(s.id)] = s;
    }
    return map;
  } catch {
    return Object.create(null);
  }
}

module.exports = {
  JORDAN_IANA_TIMEZONE,
  getJordanMinutesNow,
  parseTimeToMinutes,
  parse24hClockToMinutes,
  isWithinOpeningHours,
  isStoreVisibleToCustomers,
  isStoreListedForCustomerBrowse,
  getAdminStoreDashboardBucket,
  customerFacingIsOpen,
  loadStoresByIdMap,
};
