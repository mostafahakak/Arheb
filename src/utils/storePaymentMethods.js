/**
 * Per-store checkout payment options (stored on each store JSON row as `paymentMethods`).
 * Default when missing: all methods enabled (cod, card, cliq).
 *
 * Special / remote delivery pins (Wadi Rum, etc.) restrict checkout to Card + Cliq only (no COD).
 */

const { dropoffRequiresCardOrCliqOnly } = require('./deliveryFees');

function coercePaymentFlag(v, defaultTrue = true) {
  if (v === undefined || v === null) return defaultTrue;
  if (v === false || v === 0 || v === '0' || String(v).toLowerCase() === 'false') return false;
  return true;
}

/**
 * @param {object | null | undefined} store
 * @returns {{ cod: boolean, card: boolean, cliq: boolean }}
 */
function getStorePaymentMethods(store) {
  const pm = store && store.paymentMethods && typeof store.paymentMethods === 'object' ? store.paymentMethods : {};
  return {
    cod: coercePaymentFlag(pm.cod, true),
    card: coercePaymentFlag(pm.card, true),
    cliq: coercePaymentFlag(pm.cliq, true),
  };
}

/**
 * Effective methods for a dropoff coordinate (store flags + location rules).
 * @param {object | null | undefined} store
 * @param {unknown} lat
 * @param {unknown} lng
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
  };
}

function isEffectivePaymentMethodEnabled(store, paymentTypeLower, lat, lng, methodKey) {
  const effective = getEffectivePaymentMethodsForDropoff(store, lat, lng);
  return effective[methodKey] === true;
}

/**
 * Merge PATCH body into effective flags (partial updates allowed).
 * @param {object | null | undefined} existingStore
 * @param {object | null | undefined} patch
 */
function mergeStorePaymentMethodsPatch(existingStore, patch) {
  const base = getStorePaymentMethods(existingStore);
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base };
  if ('cod' in patch) out.cod = Boolean(patch.cod);
  if ('card' in patch) out.card = Boolean(patch.card);
  if ('cliq' in patch) out.cliq = Boolean(patch.cliq);
  return out;
}

function validatePaymentMethodsEnabled(pm) {
  if (pm.cod || pm.card || pm.cliq) return { ok: true };
  return { ok: false, message: 'At least one payment method (cod, card, cliq) must be enabled' };
}

/** @param {string} paymentTypeLower */
function paymentTypeToMethodKey(paymentTypeLower) {
  const t = String(paymentTypeLower || '').trim().toLowerCase();
  if (t === 'cash' || t === 'cod') return 'cod';
  if (t === 'card') return 'card';
  if (t === 'cliq') return 'cliq';
  return null;
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
  if (key === 'cod' && Number.isFinite(la) && Number.isFinite(ln) && dropoffRequiresCardOrCliqOnly(la, ln)) {
    return 'Cash on delivery is not available for this delivery area. Please use Card or Cliq.';
  }
  const labels = { cod: 'Cash on delivery', card: 'Card payment', cliq: 'Cliq' };
  const label = key ? labels[key] || 'This payment method' : 'This payment method';
  return `${label} is not available for this store`;
}

module.exports = {
  getStorePaymentMethods,
  getEffectivePaymentMethodsForDropoff,
  mergeStorePaymentMethodsPatch,
  validatePaymentMethodsEnabled,
  isPaymentTypeAllowedForStore,
  paymentMethodRejectedUserMessage,
};
