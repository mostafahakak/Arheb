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

module.exports = { promoAppliesToStore };
