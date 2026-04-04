const fs = require('fs');
const path = require('path');
const { getJsonPath } = require('../config/jsonPaths');
const { isStoreVisibleToCustomers, getAdminStoreDashboardBucket } = require('../utils/storeVisibility');
const { enrichOpeningHoursObject } = require('../utils/openingHoursJordan');
const { upsertStoreFcmToken } = require('../storeFcm');

const storesResponsePath = getJsonPath('stores_listing_response.json');

const loadStoresResponse = () => {
  try {
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load stores response (file missing or invalid):', error.message);
    return null;
  }
};

// Use current file data at startup for DB seed only; routes load fresh on each request
const initialResponse = loadStoresResponse();
const storesListForSeed = initialResponse?.data?.stores ?? [];

// Create store_listings table (required by checkout for ratings). Call even when stores list is empty.
function ensureStoreListingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_listings (
      id TEXT PRIMARY KEY,
      name TEXT,
      nameAr TEXT,
      nameEn TEXT,
      cover TEXT,
      logo TEXT,
      rate REAL,
      numberOfReviews INTEGER,
      isFavorite INTEGER,
      deliveryTime TEXT,
      deliveryFee REAL,
      minimumOrder REAL,
      isOpen INTEGER,
      openingHoursOpen TEXT,
      openingHoursClose TEXT,
      address TEXT,
      addressAr TEXT,
      addressEn TEXT,
      phone TEXT,
      category TEXT,
      categoryAr TEXT,
      categoryEn TEXT
    );
  `);
}

const seedStoresTable = (db, stores) => {
  ensureStoreListingsTable(db);
  if (!stores || stores.length === 0) return;

  const insert = db.prepare(`
    INSERT INTO store_listings (
      id,
      name,
      nameAr,
      nameEn,
      cover,
      logo,
      rate,
      numberOfReviews,
      isFavorite,
      deliveryTime,
      deliveryFee,
      minimumOrder,
      isOpen,
      openingHoursOpen,
      openingHoursClose,
      address,
      addressAr,
      addressEn,
      phone,
      category,
      categoryAr,
      categoryEn
    ) VALUES (
      @id,
      @name,
      @nameAr,
      @nameEn,
      @cover,
      @logo,
      @rate,
      @numberOfReviews,
      @isFavorite,
      @deliveryTime,
      @deliveryFee,
      @minimumOrder,
      @isOpen,
      @openingHoursOpen,
      @openingHoursClose,
      @address,
      @addressAr,
      @addressEn,
      @phone,
      @category,
      @categoryAr,
      @categoryEn
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      nameAr = excluded.nameAr,
      nameEn = excluded.nameEn,
      cover = excluded.cover,
      logo = excluded.logo,
      rate = excluded.rate,
      numberOfReviews = excluded.numberOfReviews,
      isFavorite = excluded.isFavorite,
      deliveryTime = excluded.deliveryTime,
      deliveryFee = excluded.deliveryFee,
      minimumOrder = excluded.minimumOrder,
      isOpen = excluded.isOpen,
      openingHoursOpen = excluded.openingHoursOpen,
      openingHoursClose = excluded.openingHoursClose,
      address = excluded.address,
      addressAr = excluded.addressAr,
      addressEn = excluded.addressEn,
      phone = excluded.phone,
      category = excluded.category,
      categoryAr = excluded.categoryAr,
      categoryEn = excluded.categoryEn
  `);

  const insertAll = db.transaction((items) => {
    for (const store of items) {
      insert.run({
        id: store.id,
        name: store.name ?? null,
        nameAr: store.nameAr ?? null,
        nameEn: store.nameEn ?? null,
        cover: store.cover ?? null,
        logo: store.logo ?? null,
        rate: typeof store.rate === 'number' ? store.rate : null,
        numberOfReviews: store.numberOfReviews ?? null,
        isFavorite: store.isFavorite ? 1 : 0,
        deliveryTime: store.deliveryTime ?? null,
        deliveryFee: typeof store.deliveryFee === 'number' ? store.deliveryFee : null,
        minimumOrder: typeof store.minimumOrder === 'number' ? store.minimumOrder : null,
        isOpen: store.isOpen ? 1 : 0,
        openingHoursOpen: store.openingHours?.open ?? null,
        openingHoursClose: store.openingHours?.close ?? null,
        address: store.address ?? null,
        addressAr: store.addressAr ?? null,
        addressEn: store.addressEn ?? null,
        phone: store.phone ?? null,
        category: store.category ?? null,
        categoryAr: store.categoryAr ?? null,
        categoryEn: store.categoryEn ?? null,
      });
    }
  });

  insertAll(stores);
};

function computeStoreStatus(store) {
  if (!store) return 'closed';
  if (store.paused === true) return 'paused';
  if (isStoreVisibleToCustomers(store)) return 'open';
  return 'closed';
}

// Public store shape: include closingTime, openingTime, storeCategories, status; never expose arhebFee
function toPublicStore(store) {
  const { arhebFee, ...rest } = store;
  const openingHours = store.openingHours
    ? enrichOpeningHoursObject(store.openingHours)
    : enrichOpeningHoursObject(null);
  return {
    ...rest,
    closingTime: store.closingTime ?? null,
    openingTime: store.openingHours?.open ?? store.openingTime ?? null,
    openingHours,
    storeCategories: Array.isArray(store.storeCategories) ? store.storeCategories : [],
    status: computeStoreStatus(store),
  };
}

function filterCustomerVisibleStores(stores) {
  return (stores || []).filter((s) => isStoreVisibleToCustomers(s));
}

module.exports = function attachStoresRoutes(app, db) {
  seedStoresTable(db, storesListForSeed);
  if (storesListForSeed.length === 0) {
    console.warn('No store data found to seed the database');
  }

  app.get('/api/stores', (req, res) => {
    const storesResponse = loadStoresResponse();
    // When file is missing (e.g. deploy), return empty list so test client / app do not get 500
    const raw = storesResponse?.data?.stores ?? [];
    const stores = filterCustomerVisibleStores(raw).map(toPublicStore);
    return res.status(200).json({
      success: true,
      message: 'Stores listing retrieved successfully',
      data: { stores },
      timestamp: storesResponse?.timestamp || new Date().toISOString(),
    });
  });

  app.get('/api/stores/top-rated', (req, res) => {
    const storesResponse = loadStoresResponse();
    const storesList = filterCustomerVisibleStores(storesResponse?.data?.stores ?? []).map(toPublicStore);
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const topRatedStores = storesList
      .filter(store => store.rate != null && typeof store.rate === 'number')
      .sort((a, b) => {
        if (b.rate !== a.rate) return b.rate - a.rate;
        return (b.numberOfReviews || 0) - (a.numberOfReviews || 0);
      })
      .slice(0, limit || storesList.length);
    return res.status(200).json({
      success: true,
      message: 'Top rated stores retrieved successfully',
      data: {
        stores: topRatedStores,
        count: topRatedStores.length,
        limit: limit || 'all'
      },
      timestamp: new Date().toISOString()
    });
  });

  // Get premium stores (set by SuperAdmin/Admin)
  app.get('/api/stores/premium', (req, res) => {
    const storesResponse = loadStoresResponse();
    const storesList = filterCustomerVisibleStores(storesResponse?.data?.stores ?? []).map(toPublicStore);
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const premiumStores = storesList.filter(store => store.isPremium === true);
    const result = limit ? premiumStores.slice(0, limit) : premiumStores;
    return res.status(200).json({
      success: true,
      message: 'Premium stores retrieved successfully',
      data: {
        stores: result,
        count: result.length,
        limit: limit || 'all'
      },
      timestamp: new Date().toISOString()
    });
  });

  // Get stores by category name (also matches store subcategories)
  app.get('/api/stores/category/:categoryName', (req, res) => {
    const categoryName = req.params.categoryName;
    if (!categoryName || categoryName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }
    const storesResponse = loadStoresResponse();
    const storesList = filterCustomerVisibleStores(storesResponse?.data?.stores ?? []).map(toPublicStore);
    const categoryNameLower = categoryName.toLowerCase().trim();
    const matches = (val) => {
      if (val == null) return false;
      const s = String(val).toLowerCase();
      return s === categoryNameLower || s.includes(categoryNameLower) || categoryNameLower.includes(s);
    };

    const storeMatchesSubCategories = (store) => {
      const subs = Array.isArray(store.subCategories) ? store.subCategories : [];
      return subs.some(sub => {
        if (typeof sub === 'string') return matches(sub);
        if (sub && typeof sub === 'object') {
          return matches(sub.name) || matches(sub.nameAr) || matches(sub.nameEn) || matches(sub.id);
        }
        return false;
      });
    };

    const storesByCategory = storesList.filter(store =>
      matches(store.category) || matches(store.categoryAr) || matches(store.categoryEn) ||
      storeMatchesSubCategories(store)
    );
    return res.status(200).json({
      success: true,
      message: 'Stores by category retrieved successfully',
      data: {
        categoryName: categoryName,
        stores: storesByCategory,
        count: storesByCategory.length
      },
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Register or update the FCM token for a store device (kitchen / POS app).
   * Token is stored in SQLite (store_fcm_tokens); public store listings never expose it.
   */
  app.post('/api/store/update-fcm', (req, res) => {
    try {
      const body = req.body || {};
      const storeId = body.storeId != null ? String(body.storeId).trim() : '';
      const fcmToken = body.fcmToken != null && typeof body.fcmToken === 'string' ? body.fcmToken : '';
      if (!storeId) {
        return res.status(400).json({
          success: false,
          message: 'storeId is required',
        });
      }
      const storesResponse = loadStoresResponse();
      const storesList = storesResponse?.data?.stores ?? [];
      const exists = storesList.some((s) => String(s.id) === String(storeId));
      if (!exists) {
        return res.status(404).json({
          success: false,
          message: 'Store not found',
        });
      }
      upsertStoreFcmToken(db, storeId, fcmToken);
      return res.status(200).json({
        success: true,
        message: 'FCM token updated',
        data: { storeId },
      });
    } catch (e) {
      console.error('update-fcm error:', e);
      return res.status(500).json({
        success: false,
        message: 'Failed to update FCM token',
      });
    }
  });

  app.get('/api/stores/:id/products', (req, res) => {
    const storeId = req.params.id;
    const storesResponse = loadStoresResponse();
    const storesList = storesResponse?.data?.stores ?? [];
    const store = storesList.find(s => s.id === storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    if (!isStoreVisibleToCustomers(store)) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const productsResponsePath = getJsonPath('products_listing_response.json');
    let productsResponse;
    try {
      const raw = fs.readFileSync(productsResponsePath, 'utf-8');
      productsResponse = JSON.parse(raw);
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Products payload is unavailable' });
    }
    if (!productsResponse) {
      return res.status(500).json({ success: false, message: 'Products payload is unavailable' });
    }

    const products = productsResponse?.data?.products ?? [];
    const storeProducts = products.filter(p => p.store?.id === storeId && p.isAvailable !== false);
    const toClientProduct = (p) => ({ ...p, discount: p.discount ?? null, originalPrice: p.originalPrice ?? p.price ?? null });

    return res.status(200).json({
      success: true,
      message: 'Store products retrieved successfully',
      data: {
        store: {
          id: store.id,
          name: store.name,
          nameAr: store.nameAr,
          nameEn: store.nameEn,
          logo: store.logo,
          cover: store.cover,
          closingTime: store.closingTime ?? null,
          openingTime: store.openingHours?.open ?? store.openingTime ?? null,
          storeCategories: Array.isArray(store.storeCategories) ? store.storeCategories : [],
          status: computeStoreStatus(store),
        },
        products: storeProducts.map(toClientProduct),
        count: storeProducts.length
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/stores/:id/products/category/:categoryName', (req, res) => {
    const storeId = req.params.id;
    const categoryName = req.params.categoryName;

    if (!categoryName || categoryName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const storesResponse = loadStoresResponse();
    const storesList = storesResponse?.data?.stores ?? [];
    const store = storesList.find(s => s.id === storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    if (!isStoreVisibleToCustomers(store)) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const productsResponsePath = getJsonPath('products_listing_response.json');
    let productsResponse;
    try {
      const raw = fs.readFileSync(productsResponsePath, 'utf-8');
      productsResponse = JSON.parse(raw);
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Products payload is unavailable' });
    }
    if (!productsResponse) {
      return res.status(500).json({ success: false, message: 'Products payload is unavailable' });
    }

    const products = productsResponse?.data?.products ?? [];
    const storeProducts = products.filter(p => p.store?.id === storeId && p.isAvailable !== false);

    const categoryNameLower = categoryName.toLowerCase().trim();
    const subCategoryQuery = (req.query.subCategory || '').trim().toLowerCase();

    let categoriesList = [];
    try {
      const catPath = getJsonPath('categories_response.json');
      const catRaw = fs.readFileSync(catPath, 'utf-8');
      const catData = JSON.parse(catRaw);
      categoriesList = catData?.data?.categories ?? [];
    } catch (_) {}

    const category = categoriesList.find(cat => {
      const catName = String(cat.name || '').toLowerCase();
      const catNameAr = String(cat.nameAr || '').toLowerCase();
      const catNameEn = String(cat.nameEn || '').toLowerCase();
      return catName === categoryNameLower || catName.includes(categoryNameLower) || categoryNameLower.includes(catName) ||
             catNameAr === categoryNameLower || catNameAr.includes(categoryNameLower) || categoryNameLower.includes(catNameAr) ||
             catNameEn === categoryNameLower || catNameEn.includes(categoryNameLower) || categoryNameLower.includes(catNameEn);
    });

    const matchTerms = [categoryNameLower];
    if (category && Array.isArray(category.subCategories)) {
      for (const sub of category.subCategories) {
        const sid = String(sub.id || '').toLowerCase();
        const sn = String(sub.name || '').toLowerCase();
        const snAr = String(sub.nameAr || '').toLowerCase();
        const snEn = String(sub.nameEn || '').toLowerCase();
        if (sid) matchTerms.push(sid);
        if (sn) matchTerms.push(sn);
        if (snAr) matchTerms.push(snAr);
        if (snEn) matchTerms.push(snEn);
      }
    }

    const productMatchesTerm = (p, term) => {
      const t = term.toLowerCase();
      const str = (v) => (v == null ? '' : String(v).toLowerCase());
      const match = (v) => v === t || v.includes(t) || t.includes(v);
      if (match(str(p.category))) return true;
      if (match(str(p.categoryEn))) return true;
      if (match(str(p.categoryAr))) return true;
      if (match(str(p.categoryName))) return true;
      if (match(str(p.subCategory))) return true;
      if (match(str(p.subCategoryEn))) return true;
      if (match(str(p.subCategoryAr))) return true;
      if (store && (match(str(store.category)) || match(str(store.categoryEn)) || match(str(store.categoryAr)))) return true;
      return false;
    };

    let filteredProducts = storeProducts.filter(p => matchTerms.some(term => productMatchesTerm(p, term)));
    if (subCategoryQuery) {
      filteredProducts = filteredProducts.filter(p => {
        const sub = [p.subCategory, p.subCategoryEn, p.subCategoryAr, p.category, p.categoryEn, p.categoryAr]
          .map(v => (v == null ? '' : String(v).toLowerCase())).filter(Boolean);
        return sub.some(s => s === subCategoryQuery || s.includes(subCategoryQuery) || subCategoryQuery.includes(s));
      });
    }
    const toClientProduct = (p) => ({ ...p, discount: p.discount ?? null, originalPrice: p.originalPrice ?? p.price ?? null });

    return res.status(200).json({
      success: true,
      message: 'Store products by category retrieved successfully',
      data: {
        store: {
          id: store.id,
          name: store.name,
          nameAr: store.nameAr,
          nameEn: store.nameEn,
          logo: store.logo,
          cover: store.cover,
          category: store.category,
          categoryAr: store.categoryAr,
          categoryEn: store.categoryEn,
          closingTime: store.closingTime ?? null,
          openingTime: store.openingHours?.open ?? store.openingTime ?? null,
          storeCategories: Array.isArray(store.storeCategories) ? store.storeCategories : [],
          status: computeStoreStatus(store),
        },
        categoryName: categoryName,
        subCategory: subCategoryQuery || null,
        products: filteredProducts.map(toClientProduct),
        count: filteredProducts.length
      },
      timestamp: new Date().toISOString()
    });
  });
};

