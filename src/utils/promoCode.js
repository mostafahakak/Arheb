/**
 * @param {{ storeId?: string | null, id?: number }} promoRow - Row from `promo_codes`
 * @param {string | null | undefined} orderStoreId - Canonical store id for the order/cart
 * @param {string[] | null | undefined} extraStoreIds - From `promo_code_stores` (multiple stores). Omit = use legacy `storeId` only.
 * @returns {boolean}
 */
function promoAppliesToStore(promoRow, orderStoreId, extraStoreIds) {
  if (!promoRow) return false;
  const orderSid = orderStoreId == null || String(orderStoreId).trim() === '' ? null : String(orderStoreId).trim();

  let restricted = null;
  if (Array.isArray(extraStoreIds) && extraStoreIds.length > 0) {
    restricted = extraStoreIds.map((x) => String(x).trim()).filter(Boolean);
  } else if (promoRow.storeId != null && String(promoRow.storeId).trim() !== '') {
    restricted = [String(promoRow.storeId).trim()];
  }
  if (!restricted || restricted.length === 0) return true;
  if (!orderSid) return false;
  return restricted.includes(orderSid);
}

/**
 * Optional cart amount floor on a promo (admin sets `minOrderAmount`).
 * Cart amount = items subtotal before delivery/service fees (client sends `cartAmount`).
 * @param {{ minOrderAmount?: number | null }} promoRow
 * @param {number | null | undefined} cartAmount
 * @returns {boolean} true when the promo is applicable (no minimum set, or cart meets/exceeds it).
 */
function promoMinAmountOk(promoRow, cartAmount) {
  if (!promoRow) return false;
  const min = promoRow.minOrderAmount;
  if (min == null || String(min).trim() === '') return true;
  const minNum = Number(min);
  if (!Number.isFinite(minNum) || minNum <= 0) return true;
  const cart = Number(cartAmount);
  if (!Number.isFinite(cart)) return false;
  return cart + 1e-9 >= minNum;
}

module.exports = { promoAppliesToStore, promoMinAmountOk };
