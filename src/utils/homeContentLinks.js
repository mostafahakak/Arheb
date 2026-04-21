/**
 * Optional app deep link on home banners / offers: product, category, or store by id (`linkTargetId`).
 * @param {object} item
 * @returns {object}
 */
function normalizeHomeContentLinkFields(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  const t = out.linkTarget;
  const valid = t === 'product' || t === 'category' || t === 'store';
  if (!valid) {
    delete out.linkTarget;
    delete out.linkTargetId;
    delete out.linkStoreId;
    return out;
  }
  out.linkTarget = t;
  const idRaw = out.linkTargetId;
  if (idRaw != null && String(idRaw).trim() !== '') {
    out.linkTargetId = String(idRaw).trim();
  } else {
    delete out.linkTargetId;
  }
  const storeRaw = out.linkStoreId;
  if (storeRaw != null && String(storeRaw).trim() !== '') {
    out.linkStoreId = String(storeRaw).trim();
  } else {
    delete out.linkStoreId;
  }
  if (t === 'product' && !out.linkTargetId) {
    delete out.linkTarget;
    delete out.linkTargetId;
    delete out.linkStoreId;
    return out;
  }
  if (t === 'store' && !out.linkTargetId) {
    delete out.linkTarget;
    delete out.linkTargetId;
    delete out.linkStoreId;
    return out;
  }
  if (t === 'category' && !out.linkTargetId) {
    delete out.linkTarget;
    delete out.linkTargetId;
    delete out.linkStoreId;
    return out;
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
