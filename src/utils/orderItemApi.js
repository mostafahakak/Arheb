/**
 * Map SQLite order_items rows to API line items (includes selectedAddOns JSON).
 */

function parseSelectedAddOnsFromRow(row) {
  if (!row || row.selectedAddOns == null || row.selectedAddOns === '') return undefined;
  try {
    const o = JSON.parse(row.selectedAddOns);
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return undefined;
    return Object.keys(o).length ? o : undefined;
  } catch (_) {
    return undefined;
  }
}

function orderItemRowToClient(row) {
  const selectedAddOns = parseSelectedAddOnsFromRow(row);
  const out = {
    id: row.productId,
    name: row.productName,
    price: row.price,
    quantity: row.quantity,
  };
  if (selectedAddOns != null) out.selectedAddOns = selectedAddOns;
  return out;
}

function mapOrderItemsRows(rows) {
  return (rows || []).map(orderItemRowToClient);
}

/** Short text for Excel / summaries */
function formatAddOnsSummary(selectedAddOns) {
  if (!selectedAddOns || typeof selectedAddOns !== 'object') return '';
  return Object.entries(selectedAddOns)
    .map(([g, opt]) => `${g}:${opt}`)
    .join(', ');
}

module.exports = {
  parseSelectedAddOnsFromRow,
  orderItemRowToClient,
  mapOrderItemsRows,
  formatAddOnsSummary,
};
