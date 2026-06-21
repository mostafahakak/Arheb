const fs = require('fs');
const { getJsonPath } = require('../config/jsonPaths');
const {
  isStoreListedForCustomerBrowse,
  customerFacingIsOpen,
  sortStoresOpenFirst,
  getAdminStoreDashboardBucket,
} = require('../utils/storeVisibility');
const { applyCatalogListPriceAndOriginal } = require('../utils/productCatalogPrice');

const storesResponsePath = getJsonPath('stores_listing_response.json');
const productsResponsePath = getJsonPath('products_listing_response.json');

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

function normalizeSearchQuery(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchesText(item, q, fields) {
  const lower = normalizeSearchQuery(q);
  if (!lower) return false;
  for (const field of fields) {
    const val = item?.[field];
    if (val != null && String(val).toLowerCase().includes(lower)) return true;
  }
  return false;
}

function storeSubCategoryValues(store) {
  const vals = [];
  const subs = Array.isArray(store?.subCategories) ? store.subCategories : [];
  for (const sub of subs) {
    if (typeof sub === 'string') vals.push(sub);
    else if (sub && typeof sub === 'object') {
      for (const k of [sub.name, sub.nameAr, sub.nameEn, sub.id]) {
        if (k != null && String(k).trim()) vals.push(String(k));
      }
    }
  }
  return vals;
}

function storeMatchesQuery(store, q) {
  if (!store) return false;
  const storeFields = [
    'name',
    'nameAr',
    'nameEn',
    'category',
    'categoryAr',
    'categoryEn',
    'address',
    'addressAr',
    'addressEn',
  ];
  if (matchesText(store, q, storeFields)) return true;
  const lower = normalizeSearchQuery(q);
  return storeSubCategoryValues(store).some((v) => String(v).toLowerCase().includes(lower));
}

function productMatchesQuery(product, q, storeById) {
  if (!product) return false;
  const productFields = [
    'name',
    'nameAr',
    'nameEn',
    'productName',
    'productNameAr',
    'productNameEn',
    'category',
    'categoryAr',
    'categoryEn',
    'categoryName',
    'description',
    'descriptionAr',
    'descriptionEn',
  ];
  if (matchesText(product, q, productFields)) return true;
  if (product.store && matchesText(product.store, q, ['name', 'nameAr', 'nameEn'])) return true;
  const fullStore =
    product.store?.id != null ? storeById[String(product.store.id)] : null;
  return storeMatchesQuery(fullStore, q);
}

function toPublicStoreRow(store) {
  const { arhebFee, hiddenFromCustomers, isOpen: _rawOpen, ...rest } = store;
  return {
    ...rest,
    isOpen: customerFacingIsOpen(store),
    status: getAdminStoreDashboardBucket(store),
  };
}

function toPublicProductRow(product, storeById) {
  const { price, originalPrice } = applyCatalogListPriceAndOriginal(product);
  const full = product.store?.id != null ? storeById[String(product.store.id)] : null;
  if (!full) return { ...product, price, originalPrice };
  return {
    ...product,
    price,
    originalPrice,
    store: {
      ...product.store,
      isOpen: customerFacingIsOpen(full),
      status: getAdminStoreDashboardBucket(full),
    },
  };
}

/**
 * Same browse rules as GET /api/stores and GET /api/products: listed unless blocked/hidden.
 * Closed/paused stores still appear with isOpen/status so customers can find them in search.
 */
function storeEligibleForCustomerSearch(store) {
  return isStoreListedForCustomerBrowse(store);
}

module.exports = function attachSearchRoutes(app) {
  app.get('/api/search', (req, res) => {
    const q = (req.query.q || req.query.query || '').trim();
    const typeRaw = String(req.query.type || req.query.scope || 'all')
      .trim()
      .toLowerCase();
    const searchStores = typeRaw === 'all' || typeRaw === 'stores' || typeRaw === 'store';
    const searchProducts = typeRaw === 'all' || typeRaw === 'products' || typeRaw === 'product';

    if (!q) {
      return res.status(200).json({
        success: true,
        message: 'Send ?q=text to search stores and products (?type=stores|products|all)',
        data: { stores: [], products: [], type: typeRaw || 'all' },
        timestamp: new Date().toISOString(),
      });
    }

    if (!searchStores && !searchProducts) {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Use all, stores, or products',
      });
    }

    const stores = loadStores();
    const products = loadProducts();
    const storeById = Object.fromEntries(
      stores.filter((s) => s && s.id != null).map((s) => [String(s.id), s]),
    );

    const matchedStores = searchStores
      ? sortStoresOpenFirst(
          stores
            .filter((s) => storeEligibleForCustomerSearch(s) && storeMatchesQuery(s, q))
            .map(toPublicStoreRow),
        )
      : [];

    const matchedProducts = searchProducts
      ? products
          .filter((p) => {
            if (p.isAvailable === false) return false;
            const storeId = p.store?.id;
            if (storeId == null) return false;
            const fullStore = storeById[String(storeId)];
            if (!storeEligibleForCustomerSearch(fullStore)) return false;
            return productMatchesQuery(p, q, storeById);
          })
          .map((p) => toPublicProductRow(p, storeById))
      : [];

    return res.status(200).json({
      success: true,
      message: 'Search results',
      data: {
        stores: matchedStores,
        products: matchedProducts,
        storeCount: matchedStores.length,
        productCount: matchedProducts.length,
        type: searchStores && searchProducts ? 'all' : searchStores ? 'stores' : 'products',
      },
      timestamp: new Date().toISOString(),
    });
  });
};
