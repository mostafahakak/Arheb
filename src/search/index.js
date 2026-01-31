const fs = require('fs');
const path = require('path');

const storesResponsePath = path.resolve(__dirname, '..', '..', 'Arheb API JSON', 'stores_listing_response.json');
const productsResponsePath = path.resolve(__dirname, '..', '..', 'Arheb API JSON', 'products_listing_response.json');

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

    const matchedStores = stores.filter((s) => matchesText(s, q, storeFields));
    const matchedProducts = products.filter((p) => matchesText(p, q, productFields));

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
