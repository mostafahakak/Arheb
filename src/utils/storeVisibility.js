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
 * Listed in public store browse (GET /api/stores, home, offers, product filters, etc.).
 * Excluded only when blocked or explicitly hidden from customers.
 * Paused, merchant-closed (isOpen=false), and outside opening hours are still returned;
 * use `customerFacingIsOpen` / `status` on each store (isOpen false when not accepting orders).
 */
function isStoreListedForCustomerBrowse(store) {
  if (!store || store.blocked === true) return false;
  if (store.hiddenFromCustomers === true) return false;
  return true;
}

/** Admin dashboard bucket: open (customer-visible) → paused → closed. */
function getAdminStoreDashboardBucket(store) {
  if (!store) return 'closed';
  if (store.paused === true) return 'paused';
  if (isStoreVisibleToCustomers(store)) return 'open';
  return 'closed';
}

const STORE_BUCKET_ORDER = { open: 0, paused: 1, closed: 2 };

/**
 * Sort key for listing: prefer `status` on already-mapped API rows (`open` | `paused` | `closed`),
 * else compute from raw store JSON.
 */
function storeSortBucket(store) {
  if (store && typeof store.status === 'string' && STORE_BUCKET_ORDER[store.status] !== undefined) {
    return store.status;
  }
  return getAdminStoreDashboardBucket(store);
}

/** Comparator: open → paused → closed, then name (EN/name/id). */
function compareStoresOpenFirstThenName(a, b) {
  const ba = storeSortBucket(a);
  const bb = storeSortBucket(b);
  const oa = STORE_BUCKET_ORDER[ba] ?? 9;
  const ob = STORE_BUCKET_ORDER[bb] ?? 9;
  if (oa !== ob) return oa - ob;
  const na = String(a.name ?? a.nameEn ?? a.id ?? '');
  const nb = String(b.name ?? b.nameEn ?? b.id ?? '');
  return na.localeCompare(nb, undefined, { sensitivity: 'base' });
}

/** Copy + sort stores for API responses (open first, then paused, then closed). */
function sortStoresOpenFirst(stores) {
  return [...(stores || [])].sort(compareStoresOpenFirstThenName);
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
  compareStoresOpenFirstThenName,
  sortStoresOpenFirst,
};
