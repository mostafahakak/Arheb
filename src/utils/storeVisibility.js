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
 * Listed in public store browse (GET /api/stores, etc.): not blocked, not hidden by Admin/SuperAdmin.
 * Each store still has `status` open | paused | closed from {@link getAdminStoreDashboardBucket}-style logic.
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

module.exports = {
  JORDAN_IANA_TIMEZONE,
  getJordanMinutesNow,
  parseTimeToMinutes,
  parse24hClockToMinutes,
  isWithinOpeningHours,
  isStoreVisibleToCustomers,
  isStoreListedForCustomerBrowse,
  getAdminStoreDashboardBucket,
};
