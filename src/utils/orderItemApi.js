/**
 * Map SQLite order_items rows to API line items (includes selectedAddOns JSON).
 */

/**
 * Map stored group/option ids to display labels using product.addOnGroups (nameEn || nameAr || id).
 */
function resolveSelectedAddOnsDisplay(product, selectedAddOns) {
  if (!product || !selectedAddOns || typeof selectedAddOns !== 'object' || Array.isArray(selectedAddOns)) return null;
  const groups = Array.isArray(product.addOnGroups) ? product.addOnGroups : [];
  const byGroupId = new Map(groups.map((g) => [String(g.id), g]));
  const out = {};
  for (const [gid, optIdRaw] of Object.entries(selectedAddOns)) {
    const optId = String(optIdRaw ?? '').trim();
    if (!optId) continue;
    const g = byGroupId.get(String(gid));
    const gLabel = String(g ? g.nameEn || g.nameAr || g.name || g.id : gid).trim() || String(gid);
    let optLabel = optId;
    if (g && Array.isArray(g.options)) {
      const o = g.options.find((x) => String(x.id) === optId);
      if (o) optLabel = String(o.nameEn || o.nameAr || o.name || o.id || optId).trim() || optId;
    }
    out[gLabel] = optLabel;
  }
  return Object.keys(out).length ? out : null;
}

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

function orderItemRowToClient(row, findProductById) {
  const selectedAddOns = parseSelectedAddOnsFromRow(row);
  const out = {
    id: row.productId,
    name: row.productName,
    price: row.price,
    quantity: row.quantity,
  };
  if (selectedAddOns != null) out.selectedAddOns = selectedAddOns;
  if (findProductById && typeof findProductById === 'function' && row.productId != null) {
    try {
      const product = findProductById(row.productId);
      const display = resolveSelectedAddOnsDisplay(product, selectedAddOns);
      if (display && Object.keys(display).length) out.selectedAddOnsDisplay = display;
    } catch (_) {
      /* ignore */
    }
  }
  if (row.notes != null && String(row.notes).trim() !== '') {
    out.notes = String(row.notes).trim();
  }
  return out;
}

function mapOrderItemsRows(rows, findProductById) {
  return (rows || []).map((r) => orderItemRowToClient(r, findProductById));
}

/** Short text for Excel / summaries (pass label map or raw id map). */
function formatAddOnsSummary(selectedAddOns) {
  if (!selectedAddOns || typeof selectedAddOns !== 'object') return '';
  return Object.entries(selectedAddOns)
    .map(([g, opt]) => `${g}:${opt}`)
    .join(', ');
}

/** Prefer human-readable add-ons when present on API line item. */
function formatOrderItemAddOnsSummary(item) {
  if (!item || typeof item !== 'object') return '';
  const map = item.selectedAddOnsDisplay || item.selectedAddOns;
  return formatAddOnsSummary(map);
}

module.exports = {
  parseSelectedAddOnsFromRow,
  normalizeSelectedAddOnsParsed,
  resolveSelectedAddOnsDisplay,
  orderItemRowToClient,
  mapOrderItemsRows,
  formatAddOnsSummary,
  formatOrderItemAddOnsSummary,
};
