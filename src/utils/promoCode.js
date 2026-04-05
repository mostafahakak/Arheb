/**
 * @param {{ storeId?: string | null }} promoRow - Row from `promo_codes` (NULL/empty storeId = all stores)
 * @param {string | null | undefined} orderStoreId - Canonical store id for the order/cart
 * @returns {boolean}
 */
function promoAppliesToStore(promoRow, orderStoreId) {
  if (!promoRow) return false;
  const restricted = promoRow.storeId != null && String(promoRow.storeId).trim() !== '';
  if (!restricted) return true;
  if (orderStoreId == null || String(orderStoreId).trim() === '') return false;
  return String(promoRow.storeId).trim() === String(orderStoreId).trim();
}

module.exports = { promoAppliesToStore };
