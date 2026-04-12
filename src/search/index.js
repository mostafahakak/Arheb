const fs = require('fs');
const path = require('path');
const { getJsonPath } = require('../config/jsonPaths');
const {
  isStoreListedForCustomerBrowse,
  isStoreVisibleToCustomers,
  customerFacingIsOpen,
} = require('../utils/storeVisibility');

const storesResponsePath = getJsonPath('stores_listing_response.json');
const productsResponsePath = getJsonPath('products_listing_response.json');

function computeStoreStatus(store) {
  if (!store) return 'closed';
  if (store.paused === true) return 'paused';
  if (isStoreVisibleToCustomers(store)) return 'open';
  return 'closed';
}

function loadStores() {
  try {
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.stores ?? [];
  } catch (e) {
    return [];
  }
}

function loadProducts() {
  try {
    const raw = fs.readFileSync(productsResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.products ?? [];
  } catch (e) {
    return [];
  }
}

function matchesText(item, q, fields) {
  const lower = (q || '').toLowerCase().trim();
  if (!lower) return false;
  for (const field of fields) {
    const val = item[field];
    if (val != null && String(val).toLowerCase().includes(lower)) return true;
  }
  return false;
}

module.exports = function attachSearchRoutes(app) {
  app.get('/api/search', (req, res) => {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) {
      return res.status(200).json({
        success: true,
        message: 'Send ?q=text to search stores and products',
        data: { stores: [], products: [] },
        timestamp: new Date().toISOString(),
      });
    }

    const stores = loadStores();
    const products = loadProducts();

    const storeFields = ['name', 'nameAr', 'nameEn', 'category', 'categoryAr', 'categoryEn'];
    const productFields = ['name', 'nameAr', 'nameEn', 'productName', 'productNameAr', 'productNameEn', 'category', 'categoryName'];

    const storeById = Object.fromEntries(stores.map((s) => [String(s.id), s]));

    const matchedStores = stores
      .filter((s) => isStoreListedForCustomerBrowse(s) && matchesText(s, q, storeFields))
      .map((s) => {
        const { arhebFee, hiddenFromCustomers, isOpen: _rawOpen, ...rest } = s;
        return { ...rest, isOpen: customerFacingIsOpen(s), status: computeStoreStatus(s) };
      });
    const matchedProducts = products.filter(
      (p) =>
        p.isAvailable !== false &&
        matchesText(p, q, productFields) &&
        p.store?.id != null &&
        isStoreListedForCustomerBrowse(storeById[String(p.store.id)]),
    );

    return res.status(200).json({
      success: true,
      message: 'Search results',
      data: {
        stores: matchedStores,
        products: matchedProducts,
      },
      timestamp: new Date().toISOString(),
    });
  });
};
