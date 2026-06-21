/** Order status helpers mirroring the backend store-admin rules. */

export function normalizeStatusKey(status) {
  return String(status || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalize an admin role to backend keys: superadmin | admin | store_admin. */
export function normalizeRole(role) {
  const r = String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
  if (r === 'super_admin') return 'superadmin';
  return r;
}

export function isStoreAdminRole(role) {
  return normalizeRole(role) === 'store_admin';
}

/** Admin/superadmin can manage drivers (matches backend requireAdminOrSuper). */
export function canManageDrivers(role) {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'superadmin';
}

/** Full status list for admin/superadmin status dropdown. */
export const STATUS_DETAIL_OPTIONS = [
  'Pending payment',
  'Waiting confirmation',
  'Waiting cliq confirmation',
  'Payment rejected',
  'Preparing',
  'In progress',
  'On the way',
  'Delivered',
  'Cancelled',
];

/**
 * Status options for the detail screen.
 * - store_admin: current status + allowed next step(s); no Cancelled (use Reject).
 * - admin/superadmin: full list.
 */
export function getDetailStatusOptions(role, currentStatus) {
  if (!isStoreAdminRole(role)) return STATUS_DETAIL_OPTIONS;
  const curKey = normalizeStatusKey(currentStatus);
  if (curKey === 'cancelled') return ['Cancelled'];
  const allowed = storeAdminNextStatuses(currentStatus);
  const allowedKeys = new Set([curKey, ...allowed.map((s) => normalizeStatusKey(s))]);
  const opts = STATUS_DETAIL_OPTIONS.filter(
    (o) => o !== 'Cancelled' && allowedKeys.has(normalizeStatusKey(o)),
  );
  const cur = String(currentStatus || '').trim();
  if (cur && !opts.some((o) => normalizeStatusKey(o) === curKey)) opts.unshift(cur);
  return opts;
}

function orderHasAssignedDriver(order) {
  if (!order || order.driverId == null || order.driverId === '') return false;
  const n = Number(order.driverId);
  return Number.isFinite(n) && n > 0;
}

/** Preparing + no driver: eligible for first assignment (store orders). */
export function isPreparingAndUnassigned(order) {
  const n = normalizeStatusKey(order?.status);
  return (n === 'preparing' || n === 'being prepared') && !orderHasAssignedDriver(order);
}

/** Store order with a driver that can still be reassigned (matches backend rules). */
export function canReassignDriver(order) {
  if (!orderHasAssignedDriver(order)) return false;
  const s = normalizeStatusKey(order?.status);
  if (s.includes('delivered') || s.includes('cancelled')) return false;
  return (
    s.includes('preparing') ||
    s.includes('being prepared') ||
    s.includes('on the way') ||
    s.includes('driver to pick') ||
    s.includes('in progress')
  );
}

/** Next status a store admin may advance to (one step forward). */
export function storeAdminNextStatuses(status) {
  const k = normalizeStatusKey(status);
  const map = {
    'pending payment': [],
    'waiting cliq confirmation': ['Waiting confirmation'],
    'waiting confirmation': ['Preparing'],
    preparing: ['On the way'],
    'being prepared': ['On the way'],
    'driver to pick': ['On the way'],
    'in progress': ['On the way'],
  };
  return map[k] || [];
}

/** Store admin can reject (cancel) only before the order is confirmed for preparation. */
export function storeAdminCanReject(status) {
  const k = normalizeStatusKey(status);
  return k === 'pending payment' || k === 'waiting cliq confirmation' || k === 'waiting confirmation';
}

/** Reject eligibility for any role (admin/superadmin: same waiting/pending window). */
export function canRejectOrder(role, status) {
  return storeAdminCanReject(status);
}

/** Items-only subtotal (sum of price*qty, else totalAmount). */
export function itemsSubtotal(order) {
  const items = order?.items;
  if (Array.isArray(items) && items.length) {
    return round2(items.reduce((sum, i) => sum + num(i.price) * num(i.quantity), 0));
  }
  return round2(num(order?.totalAmount));
}

/** Payable grand total: items subtotal + delivery + service + tax. */
export function grandTotal(order) {
  return round2(
    itemsSubtotal(order) + num(order?.deliveryFee) + num(order?.serviceFee) + num(order?.feesTax),
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizePaymentTypeKey(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Human-readable payment type for store admin UI. */
export function formatPaymentType(paymentType, t) {
  const key = normalizePaymentTypeKey(paymentType);
  if (!key) return '—';
  if (key === 'cash' || key === 'cod') return t?.('cod') || 'Cash on delivery';
  if (key === 'card') return t?.('card') || 'Card';
  if (key === 'cliq') return t?.('cliq') || 'Cliq';
  if (key === 'visaondelivery' || key === 'visa_on_delivery' || key.replace(/\s+/g, '') === 'visaondelivery') {
    return t?.('visaOnDelivery') || 'Visa on delivery';
  }
  return String(paymentType || '—');
}

export const ORDER_STATUS_FILTERS = [
  { key: '', labelKey: 'all' },
  { key: 'Waiting confirmation', label: 'Waiting' },
  { key: 'Preparing', label: 'Preparing' },
  { key: 'On the way', label: 'On the way' },
  { key: 'Delivered', label: 'Delivered' },
  { key: 'Cancelled', label: 'Cancelled' },
];

export function money(n, currency = 'JOD') {
  const v = Number(n);
  if (!Number.isFinite(v)) return `0.00 ${currency}`;
  return `${v.toFixed(2)} ${currency}`;
}

export function shortTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch (e) {
    return String(iso);
  }
}
