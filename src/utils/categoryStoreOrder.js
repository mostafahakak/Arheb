'use strict';

const { compareStoresOpenFirstThenName } = require('./storeVisibility');

function ensureCategoryStoreOrderTable(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_store_display_order (
      categoryId TEXT NOT NULL,
      storeId TEXT NOT NULL,
      displayOrder INTEGER NOT NULL,
      PRIMARY KEY (categoryId, storeId)
    )
  `);
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_category_store_display_order_cat ON category_store_display_order(categoryId, displayOrder)',
    );
  } catch (e) {
    /* ignore */
  }
}

function categoryMatchTerms(category) {
  const terms = new Set();
  if (!category) return [];
  for (const v of [category.id, category.name, category.nameEn, category.nameAr]) {
    if (v != null && String(v).trim()) terms.add(String(v).trim().toLowerCase());
  }
  if (Array.isArray(category.subCategories)) {
    for (const sub of category.subCategories) {
      if (typeof sub === 'string' && sub.trim()) terms.add(sub.trim().toLowerCase());
      else if (sub && typeof sub === 'object') {
        for (const k of [sub.id, sub.name, sub.nameEn, sub.nameAr]) {
          if (k != null && String(k).trim()) terms.add(String(k).trim().toLowerCase());
        }
      }
    }
  }
  return [...terms];
}

/** Same matching rules as GET /api/stores/category/:categoryName. */
function storeMatchesBrowseCategory(store, category) {
  if (!store || !category) return false;
  const terms = categoryMatchTerms(category);
  if (!terms.length) return false;
  const matches = (val) => {
    if (val == null) return false;
    const s = String(val).trim().toLowerCase();
    return terms.some((t) => s === t || s.includes(t) || t.includes(s));
  };
  if (matches(store.category) || matches(store.categoryAr) || matches(store.categoryEn)) return true;
  const subs = Array.isArray(store.subCategories) ? store.subCategories : [];
  return subs.some((sub) => {
    if (typeof sub === 'string') return matches(sub);
    if (sub && typeof sub === 'object') {
      return matches(sub.name) || matches(sub.nameAr) || matches(sub.nameEn) || matches(sub.id);
    }
    return false;
  });
}

function findBrowseCategory(categories, { categoryId, categoryName } = {}) {
  const list = Array.isArray(categories) ? categories : [];
  if (categoryId != null && String(categoryId).trim()) {
    const id = String(categoryId).trim();
    const byId = list.find((c) => String(c.id) === id);
    if (byId) return byId;
  }
  if (categoryName != null && String(categoryName).trim()) {
    const q = String(categoryName).trim().toLowerCase();
    return (
      list.find((c) => {
        const vals = [c.id, c.name, c.nameEn, c.nameAr].filter(Boolean).map((v) => String(v).trim().toLowerCase());
        return vals.some((v) => v === q || v.includes(q) || q.includes(v));
      }) || null
    );
  }
  return null;
}

function getCategoryStoreOrderMap(db, categoryId) {
  ensureCategoryStoreOrderTable(db);
  const rows = db
    .prepare(
      'SELECT storeId, displayOrder FROM category_store_display_order WHERE categoryId = ? ORDER BY displayOrder ASC, storeId ASC',
    )
    .all(String(categoryId));
  const map = new Map();
  for (const r of rows) map.set(String(r.storeId), Number(r.displayOrder));
  return map;
}

function getCategoryStoreOrderIds(db, categoryId) {
  const map = getCategoryStoreOrderMap(db, categoryId);
  return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

function saveCategoryStoreOrder(db, categoryId, orderedStoreIds) {
  ensureCategoryStoreOrderTable(db);
  const cid = String(categoryId);
  const ids = (orderedStoreIds || []).map((id) => String(id)).filter(Boolean);
  const del = db.prepare('DELETE FROM category_store_display_order WHERE categoryId = ?');
  const ins = db.prepare(
    'INSERT INTO category_store_display_order (categoryId, storeId, displayOrder) VALUES (?, ?, ?)',
  );
  const tx = db.transaction((storeIds) => {
    del.run(cid);
    storeIds.forEach((sid, i) => ins.run(cid, sid, i + 1));
  });
  tx(ids);
  return ids.map((storeId, i) => ({ storeId, displayOrder: i + 1 }));
}

/** Per-category manual order first; then default store listing sort. */
function sortStoresByCategoryDisplayOrder(stores, orderByStoreId) {
  const map = orderByStoreId instanceof Map ? orderByStoreId : new Map();
  return [...(stores || [])].sort((a, b) => {
    const oa = map.has(String(a.id)) ? map.get(String(a.id)) : Infinity;
    const ob = map.has(String(b.id)) ? map.get(String(b.id)) : Infinity;
    if (oa !== ob) return oa - ob;
    return compareStoresOpenFirstThenName(a, b);
  });
}

function listStoresForBrowseCategory(allStores, category, orderByStoreId) {
  const matched = (allStores || []).filter((s) => storeMatchesBrowseCategory(s, category));
  return sortStoresByCategoryDisplayOrder(matched, orderByStoreId);
}

module.exports = {
  ensureCategoryStoreOrderTable,
  categoryMatchTerms,
  storeMatchesBrowseCategory,
  findBrowseCategory,
  getCategoryStoreOrderMap,
  getCategoryStoreOrderIds,
  saveCategoryStoreOrder,
  sortStoresByCategoryDisplayOrder,
  listStoresForBrowseCategory,
};
