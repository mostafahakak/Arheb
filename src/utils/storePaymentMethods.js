/**
 * Per-store checkout payment options (stored on each store JSON row as `paymentMethods`).
 * Default when missing: all methods enabled (cod, card, cliq).
 */

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
 */
function isPaymentTypeAllowedForStore(store, paymentTypeLower) {
  const key = paymentTypeToMethodKey(paymentTypeLower);
  if (!key) return true;
  const pm = getStorePaymentMethods(store);
  return pm[key] === true;
}

/** @param {string} paymentTypeLower */
function paymentMethodRejectedUserMessage(paymentTypeLower) {
  const key = paymentTypeToMethodKey(paymentTypeLower);
  const labels = { cod: 'Cash on delivery', card: 'Card payment', cliq: 'Cliq' };
  const label = key ? labels[key] || 'This payment method' : 'This payment method';
  return `${label} is not available for this store`;
}

module.exports = {
  getStorePaymentMethods,
  mergeStorePaymentMethodsPatch,
  validatePaymentMethodsEnabled,
  isPaymentTypeAllowedForStore,
  paymentMethodRejectedUserMessage,
};
