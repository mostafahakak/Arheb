/**
 * Per-store checkout payment options (stored on each store JSON row as `paymentMethods`).
 * Default when missing: all methods enabled (cod, card, cliq, visaondelivery).
 *
 * Special / remote delivery pins (Wadi Rum, etc.) restrict checkout to Card + Cliq only (no COD / no Visa on delivery).
 */

const { dropoffRequiresCardOrCliqOnly } = require('./deliveryFees');

/** Canonical API key for Visa on delivery (no underscore). */
const VISA_ON_DELIVERY_METHOD = 'visaondelivery';

function coercePaymentFlag(v, defaultTrue = true) {
  if (v === undefined || v === null) return defaultTrue;
  if (v === false || v === 0 || v === '0' || String(v).toLowerCase() === 'false') return false;
  return true;
}

/** Read visa flag from stored JSON (supports legacy `visa_on_delivery`). */
function readVisaOnDeliveryFlag(pm) {
  if (!pm || typeof pm !== 'object') return undefined;
  if ('visaondelivery' in pm) return pm.visaondelivery;
  if ('visa_on_delivery' in pm) return pm.visa_on_delivery;
  return undefined;
}

/**
 * @param {object | null | undefined} store
 * @returns {{ cod: boolean, card: boolean, cliq: boolean, visaondelivery: boolean }}
 */
function getStorePaymentMethods(store) {
  const pm = store && store.paymentMethods && typeof store.paymentMethods === 'object' ? store.paymentMethods : {};
  const visaRaw = readVisaOnDeliveryFlag(pm);
  return {
    cod: coercePaymentFlag(pm.cod, true),
    card: coercePaymentFlag(pm.card, true),
    cliq: coercePaymentFlag(pm.cliq, true),
    visaondelivery: coercePaymentFlag(visaRaw, true),
  };
}

/**
 * Effective methods for a dropoff coordinate (store flags + location rules).
 * Remote / special-far zones disable COD and Visa on delivery (card + cliq only).
 */
function getEffectivePaymentMethodsForDropoff(store, lat, lng) {
  const base = getStorePaymentMethods(store);
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || !dropoffRequiresCardOrCliqOnly(la, ln)) {
    return base;
  }
  return {
    cod: false,
    card: true,
    cliq: true,
    visaondelivery: false,
  };
}

function isEffectivePaymentMethodEnabled(store, paymentTypeLower, lat, lng, methodKey) {
  const effective = getEffectivePaymentMethodsForDropoff(store, lat, lng);
  return effective[methodKey] === true;
}

/**
 * Merge PATCH body into effective flags (partial updates allowed).
 * Output always uses canonical `visaondelivery` (no underscore).
 */
function mergeStorePaymentMethodsPatch(existingStore, patch) {
  const base = getStorePaymentMethods(existingStore);
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base };
  if ('cod' in patch) out.cod = Boolean(patch.cod);
  if ('card' in patch) out.card = Boolean(patch.card);
  if ('cliq' in patch) out.cliq = Boolean(patch.cliq);
  if ('visaondelivery' in patch) out.visaondelivery = Boolean(patch.visaondelivery);
  else if ('visa_on_delivery' in patch) out.visaondelivery = Boolean(patch.visa_on_delivery);
  return out;
}

function validatePaymentMethodsEnabled(pm) {
  if (pm.cod || pm.card || pm.cliq || pm.visaondelivery) return { ok: true };
  return { ok: false, message: 'At least one payment method (cod, card, cliq, visaondelivery) must be enabled' };
}

/** @param {string} paymentTypeLower */
function paymentTypeToMethodKey(paymentTypeLower) {
  const t = String(paymentTypeLower || '').trim().toLowerCase();
  if (t === 'cash' || t === 'cod') return 'cod';
  if (t === 'card') return 'card';
  if (t === 'cliq') return 'cliq';
  if (
    t === 'visaondelivery' ||
    t === 'visa_on_delivery' ||
    t === 'visa on delivery' ||
    t === 'visondelivery'
  ) {
    return VISA_ON_DELIVERY_METHOD;
  }
  return null;
}

/** Normalize checkout / stored order paymentType to canonical display value. */
function normalizePaymentTypeForStorage(paymentType) {
  const t = String(paymentType || '').trim().toLowerCase();
  if (t === 'wallet+card') return 'Wallet+Card';
  if (t === 'wallet+cliq') return 'Wallet+Cliq';
  if (t === 'wallet') return 'Wallet';
  if (t === 'card') return 'Card';
  if (t === 'cliq') return 'Cliq';
  if (t === 'cash' || t === 'cod') return 'Cash';
  if (paymentTypeToMethodKey(t) === VISA_ON_DELIVERY_METHOD) return 'Visaondelivery';
  const s = String(paymentType || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * SQL-friendly aliases for admin `paymentType` filter (case-insensitive match).
 * @param {string} filterPaymentType
 * @returns {string[]|null} null = use filter as-is only
 */
function paymentTypeFilterValues(filterPaymentType) {
  const filter = String(filterPaymentType || '').trim();
  if (!filter) return null;
  const key = paymentTypeToMethodKey(filter.toLowerCase());
  if (key === VISA_ON_DELIVERY_METHOD) {
    return ['visaondelivery', 'Visaondelivery', 'visa_on_delivery', 'Visa_on_delivery', 'visa on delivery', 'Visa on delivery'];
  }
  if (key === 'cod') return ['cash', 'Cash', 'cod', 'COD'];
  if (key === 'card') return ['card', 'Card'];
  if (key === 'cliq') return ['cliq', 'Cliq'];
  return [filter];
}

/**
 * @param {object | null | undefined} store - raw store from JSON
 * @param {string} paymentTypeLower - lowercased paymentType from checkout
 * @param {unknown} [lat] - delivery latitude (optional; enables location rules)
 * @param {unknown} [lng] - delivery longitude
 */
function isPaymentTypeAllowedForStore(store, paymentTypeLower, lat, lng) {
  const key = paymentTypeToMethodKey(paymentTypeLower);
  if (!key) return true;
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (Number.isFinite(la) && Number.isFinite(ln)) {
    return isEffectivePaymentMethodEnabled(store, paymentTypeLower, la, ln, key);
  }
  const pm = getStorePaymentMethods(store);
  return pm[key] === true;
}

/** @param {string} paymentTypeLower */
function paymentMethodRejectedUserMessage(paymentTypeLower, lat, lng) {
  const key = paymentTypeToMethodKey(paymentTypeLower);
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (
    (key === 'cod' || key === VISA_ON_DELIVERY_METHOD) &&
    Number.isFinite(la) &&
    Number.isFinite(ln) &&
    dropoffRequiresCardOrCliqOnly(la, ln)
  ) {
    return 'Cash / Visa on delivery is not available for this delivery area. Please use Card or Cliq.';
  }
  const labels = {
    cod: 'Cash on delivery',
    card: 'Card payment',
    cliq: 'Cliq',
    visaondelivery: 'Visa on delivery',
  };
  const label = key ? labels[key] || 'This payment method' : 'This payment method';
  return `${label} is not available for this store`;
}

/** Labels for admin/dashboard payment type filter dropdown. */
function getAvailablePaymentTypesCatalog() {
  return [
    { key: 'cash', label: 'Cash on delivery', labelAr: 'الدفع عند الاستلام' },
    { key: 'Card', label: 'Card', labelAr: 'بطاقة' },
    { key: 'Cliq', label: 'Cliq', labelAr: 'كليك' },
    { key: 'visaondelivery', label: 'Visa on delivery', labelAr: 'فيزا عند الاستلام' },
  ];
}

/** Append paymentType filter to SQL WHERE (matches legacy stored values). */
function appendPaymentTypeSqlFilter(conditions, params, filterPaymentType, columnName = 'paymentType') {
  const filter = String(filterPaymentType || '').trim();
  if (!filter) return;
  const aliases = paymentTypeFilterValues(filter);
  const values = (aliases || [filter]).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (values.length === 1) {
    conditions.push(`LOWER(TRIM(COALESCE(${columnName}, ''))) = ?`);
    params.push(values[0]);
    return;
  }
  conditions.push(
    `LOWER(TRIM(COALESCE(${columnName}, ''))) IN (${values.map(() => '?').join(', ')})`,
  );
  params.push(...values);
}

module.exports = {
  VISA_ON_DELIVERY_METHOD,
  getStorePaymentMethods,
  getEffectivePaymentMethodsForDropoff,
  mergeStorePaymentMethodsPatch,
  validatePaymentMethodsEnabled,
  isPaymentTypeAllowedForStore,
  paymentMethodRejectedUserMessage,
  normalizePaymentTypeForStorage,
  paymentTypeFilterValues,
  getAvailablePaymentTypesCatalog,
  appendPaymentTypeSqlFilter,
};
