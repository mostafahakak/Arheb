/**
 * Optional app deep link on home banners / offers: open a product or category by id.
 * @param {object} item
 * @returns {object}
 */
function normalizeHomeContentLinkFields(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  const t = out.linkTarget;
  const valid = t === 'product' || t === 'category';
  if (!valid) {
    delete out.linkTarget;
    delete out.linkTargetId;
    return out;
  }
  out.linkTarget = t;
  const idRaw = out.linkTargetId;
  if (idRaw != null && String(idRaw).trim() !== '') {
    out.linkTargetId = String(idRaw).trim();
  } else {
    delete out.linkTargetId;
  }
  return out;
}

/**
 * @param {object[]} items
 * @returns {object[]}
 */
function normalizeHomeContentLinkArray(items) {
  if (!Array.isArray(items)) return [];
  return items.map((row) => normalizeHomeContentLinkFields(row));
}

module.exports = {
  normalizeHomeContentLinkFields,
  normalizeHomeContentLinkArray,
};
