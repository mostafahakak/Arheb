/**
 * Map SQLite order_items rows to API line items (includes selectedAddOns JSON).
 */

function normalizeSelectedAddOnsParsed(o) {
  if (o == null) return undefined;
  if (typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length) return o;
  if (Array.isArray(o) && o.length) {
    const out = {};
    for (const entry of o) {
      if (!entry || typeof entry !== 'object') continue;
      const g = entry.groupName ?? entry.group ?? entry.groupId ?? entry.name;
      const v = entry.optionName ?? entry.option ?? entry.optionId ?? entry.value;
      const gk = String(g != null ? g : 'Add-on').trim() || 'Add-on';
      const vk = String(v != null ? v : '').trim();
      if (vk) out[gk] = vk;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function parseSelectedAddOnsFromRow(row) {
  if (!row || row.selectedAddOns == null || row.selectedAddOns === '') return undefined;
  try {
    const o = JSON.parse(row.selectedAddOns);
    return normalizeSelectedAddOnsParsed(o);
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
  normalizeSelectedAddOnsParsed,
  orderItemRowToClient,
  mapOrderItemsRows,
  formatAddOnsSummary,
};
