const fs = require('fs');
const path = require('path');
const { getJsonPath } = require('../config/jsonPaths');
const {
  isStoreVisibleToCustomers,
  isStoreListedForCustomerBrowse,
  customerFacingIsOpen,
  compareStoresOpenFirstThenName,
  sortStoresOpenFirst,
} = require('../utils/storeVisibility');
const {
  ensureCategoryStoreOrderTable,
  findBrowseCategory,
  getCategoryStoreOrderMap,
  listStoresForBrowseCategory,
} = require('../utils/categoryStoreOrder');
const { loadCategoriesFromDb } = require('../categories');
const { applyCatalogListPriceAndOriginal } = require('../utils/productCatalogPrice');
const { getStorePaymentMethods, getEffectivePaymentMethodsForDropoff } = require('../utils/storePaymentMethods');
const { enrichOpeningHoursObject } = require('../utils/openingHoursJordan');
const { upsertStoreFcmToken } = require('../storeFcm');
const { getPlatformCheckoutFeeTiers } = require('../utils/platformCheckoutFees');
const { effectiveStoreListingDeliveryFeeJod } = require('../utils/deliveryFees');
const { resolveStoreFoodTypes } = require('../foodTypes');

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

// Public store shape: include closingTime, openingTime, storeCategories, status; never expose arhebFee / admin-only flags
function toPublicStore(store, platformTiers) {
  const { arhebFee, hiddenFromCustomers, isOpen: _rawIsOpen, ...rest } = store;
  const openingHours = store.openingHours
    ? enrichOpeningHoursObject(store.openingHours)
    : enrichOpeningHoursObject(null);
  const listingDeliveryFee = effectiveStoreListingDeliveryFeeJod(store, platformTiers);
  return {
    ...rest,
    ...(listingDeliveryFee != null ? { deliveryFee: listingDeliveryFee } : {}),
    isOpen: customerFacingIsOpen(store),
    isPremium: store.isPremium === true,
    isExclusive: store.isExclusive === true,
    closingTime: store.closingTime ?? null,
    openingTime: store.openingHours?.open ?? store.openingTime ?? null,
    openingHours,
    storeCategories: Array.isArray(store.storeCategories) ? store.storeCategories : [],
    foodTypes: resolveStoreFoodTypes(store),
    status: computeStoreStatus(store),
    paymentMethods: getStorePaymentMethods(store),
  };
}

function storePayloadForProductRoutes(store) {
  if (!store) return null;
  return {
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
    foodTypes: resolveStoreFoodTypes(store),
    status: computeStoreStatus(store),
    isOpen: customerFacingIsOpen(store),
    isExclusive: store.isExclusive === true,
    isPremium: store.isPremium === true,
    paymentMethods: getStorePaymentMethods(store),
  };
}

function filterCustomerVisibleStores(stores) {
  return (stores || []).filter((s) => isStoreVisibleToCustomers(s));
}

function filterStoresForCustomerBrowse(stores) {
  return (stores || []).filter((s) => isStoreListedForCustomerBrowse(s));
}

function hasDiscount(p) {
  const d = p.discount;
  if (d == null || d === '') return false;
  if (typeof d === 'number') return d > 0;
  const n = parseFloat(String(d).replace(/%/g, ''), 10);
  return !Number.isNaN(n) && n > 0;
}

function buildStoreIdsWithOffers() {
  try {
    const productsPath = getJsonPath('products_listing_response.json');
    const raw = fs.readFileSync(productsPath, 'utf-8');
    const allProducts = JSON.parse(raw)?.data?.products ?? [];
    const ids = new Set();
    for (const p of allProducts) {
      if (p.isAvailable !== false && hasDiscount(p) && p.store?.id != null) {
        ids.add(String(p.store.id));
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

function enrichStoresWithOffers(stores) {
  const offerStoreIds = buildStoreIdsWithOffers();
  return stores.map((s) => ({ ...s, hasOffers: offerStoreIds.has(String(s.id)) }));
}

module.exports = function attachStoresRoutes(app, db) {
  seedStoresTable(db, storesListForSeed);
  if (storesListForSeed.length === 0) {
    console.warn('No store data found to seed the database');
  }

  function mapPublicStores(stores) {
    const platformTiers = getPlatformCheckoutFeeTiers(db);
    return (stores || []).map((s) => toPublicStore(s, platformTiers));
  }

  app.get('/api/stores', (req, res) => {
    const storesResponse = loadStoresResponse();
    const raw = storesResponse?.data?.stores ?? [];
    const stores = enrichStoresWithOffers(sortStoresOpenFirst(filterStoresForCustomerBrowse(mapPublicStores(raw))));
    return res.status(200).json({
      success: true,
      message: 'Stores listing retrieved successfully',
      data: { stores },
      timestamp: storesResponse?.timestamp || new Date().toISOString(),
    });
  });

  app.get('/api/stores/top-rated', (req, res) => {
    const storesResponse = loadStoresResponse();
    const storesList = sortStoresOpenFirst(
      filterStoresForCustomerBrowse(storesResponse?.data?.stores ?? []).map((s) => toPublicStore(s, getPlatformCheckoutFeeTiers(db))),
    );
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const topRatedStores = storesList
      .filter(store => store.rate != null && typeof store.rate === 'number')
      .sort((a, b) => {
        const byStatus = compareStoresOpenFirstThenName(a, b);
        if (byStatus !== 0) return byStatus;
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

  function exclusiveStoresPayload(storesResponse, limit) {
    const storesList = sortStoresOpenFirst(
      filterStoresForCustomerBrowse(storesResponse?.data?.stores ?? []).map((s) => toPublicStore(s, getPlatformCheckoutFeeTiers(db))),
    );
    const exclusive = storesList.filter((store) => store.isExclusive === true);
    const result = enrichStoresWithOffers(limit ? exclusive.slice(0, limit) : exclusive);
    return { stores: result, count: result.length, limit: limit || 'all' };
  }

  function premiumStoresPayload(storesResponse, limit) {
    const storesList = sortStoresOpenFirst(
      filterStoresForCustomerBrowse(storesResponse?.data?.stores ?? []).map((s) => toPublicStore(s, getPlatformCheckoutFeeTiers(db))),
    );
    const premium = storesList.filter((store) => store.isPremium === true);
    const result = enrichStoresWithOffers(limit ? premium.slice(0, limit) : premium);
    return { stores: result, count: result.length, limit: limit || 'all' };
  }

  // Premium stores (set by SuperAdmin/Admin)
  app.get('/api/stores/premium', (req, res) => {
    const storesResponse = loadStoresResponse();
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const { stores, count, limit: lim } = premiumStoresPayload(storesResponse, limit);
    return res.status(200).json({
      success: true,
      message: 'Premium stores retrieved successfully',
      data: { stores, count, limit: lim },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/stores/exclusive', (req, res) => {
    const storesResponse = loadStoresResponse();
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const { stores, count, limit: lim } = exclusiveStoresPayload(storesResponse, limit);
    return res.status(200).json({
      success: true,
      message: 'Exclusive stores retrieved successfully',
      data: { stores, count, limit: lim },
      timestamp: new Date().toISOString(),
    });
  });

  // Get stores by category name (also matches store subcategories)
  app.get('/api/stores/category/:categoryName', (req, res) => {
    const categoryName = req.params.categoryName;
    if (!categoryName || categoryName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }
    const storesResponse = loadStoresResponse();
    const rawStores = filterStoresForCustomerBrowse(storesResponse?.data?.stores ?? []).map((s) =>
      toPublicStore(s, getPlatformCheckoutFeeTiers(db)),
    );

    const fromDb = loadCategoriesFromDb(db);
    const browseCategories = fromDb?.data?.categories ?? [];
    const browseCategory = findBrowseCategory(browseCategories, { categoryName });
    let storesByCategory;
    if (browseCategory && browseCategory.id != null && String(browseCategory.id) !== 'offers') {
      ensureCategoryStoreOrderTable(db);
      const orderMap = getCategoryStoreOrderMap(db, browseCategory.id);
      storesByCategory = enrichStoresWithOffers(
        listStoresForBrowseCategory(rawStores, browseCategory, orderMap),
      );
    } else {
      const storesList = sortStoresOpenFirst(rawStores);
      const categoryNameLower = categoryName.toLowerCase().trim();
      const matches = (val) => {
        if (val == null) return false;
        const s = String(val).toLowerCase();
        return s === categoryNameLower || s.includes(categoryNameLower) || categoryNameLower.includes(s);
      };
      const storeMatchesSubCategories = (store) => {
        const subs = Array.isArray(store.subCategories) ? store.subCategories : [];
        return subs.some((sub) => {
          if (typeof sub === 'string') return matches(sub);
          if (sub && typeof sub === 'object') {
            return matches(sub.name) || matches(sub.nameAr) || matches(sub.nameEn) || matches(sub.id);
          }
          return false;
        });
      };
      storesByCategory = enrichStoresWithOffers(
        storesList.filter(
          (store) =>
            matches(store.category) ||
            matches(store.categoryAr) ||
            matches(store.categoryEn) ||
            storeMatchesSubCategories(store),
        ),
      );
    }
    return res.status(200).json({
      success: true,
      message: 'Stores by category retrieved successfully',
      data: {
        categoryName: categoryName,
        categoryId: browseCategory?.id ?? null,
        stores: storesByCategory,
        count: storesByCategory.length,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Register or update the FCM token for a store device (kitchen / POS app).
   * Token is stored in SQLite (store_fcm_tokens); public store listings never expose it.
   */
  /**
   * Which checkout payment options the store accepts (COD / card / Cliq).
   * Omitted or missing flags default to true in `getStorePaymentMethods`.
   */
  app.get('/api/stores/:id/payment-methods', (req, res) => {
    const storeId = req.params.id;
    const storesResponse = loadStoresResponse();
    const storesList = storesResponse?.data?.stores ?? [];
    const store = storesList.find((s) => String(s.id) === String(storeId));
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    if (!isStoreListedForCustomerBrowse(store)) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    const latRaw = req.query.latitude ?? req.query.lat;
    const lngRaw = req.query.longitude ?? req.query.lng ?? req.query.long;
    const lat = latRaw != null && latRaw !== '' ? Number(latRaw) : null;
    const lng = lngRaw != null && lngRaw !== '' ? Number(lngRaw) : null;
    const paymentMethods =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? getEffectivePaymentMethodsForDropoff(store, lat, lng)
        : getStorePaymentMethods(store);
    return res.status(200).json({
      success: true,
      message: 'Store payment methods',
      data: {
        storeId: String(store.id),
        paymentMethods,
        ...(!paymentMethods.cod && !paymentMethods.visaondelivery && Number.isFinite(lat) && Number.isFinite(lng)
          ? {
              paymentMethodsNote:
                'Cash / Visa on delivery is not available for this delivery area. Use Card or Cliq.',
            }
          : {}),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/store/update-fcm', (req, res) => {
    try {
      const body = req.body || {};
      const storeId = body.storeId != null ? String(body.storeId).trim() : '';
      const fcmToken =
        body.fcmToken != null && String(body.fcmToken).trim() !== ''
          ? String(body.fcmToken).trim()
          : '';
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
    const store = storesList.find((s) => String(s.id) === String(storeId));
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    if (!isStoreListedForCustomerBrowse(store)) {
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
    const storeProducts = products.filter((p) => String(p.store?.id) === String(storeId) && p.isAvailable !== false);
    const toClientProduct = (p) => {
      const { price, originalPrice } = applyCatalogListPriceAndOriginal(p);
      return {
        ...p,
        price,
        originalPrice,
        discount: p.discount ?? null,
        store: p.store ? { ...p.store, isOpen: customerFacingIsOpen(store) } : p.store,
      };
    };

    return res.status(200).json({
      success: true,
      message: 'Store products retrieved successfully',
      data: {
        store: storePayloadForProductRoutes(store),
        products: storeProducts.map(toClientProduct),
        count: storeProducts.length
      },
      timestamp: new Date().toISOString()
    });
  });

  /** Stable sort so pagination slices never overlap or repeat across pages. */
  const compareProductIdStable = (a, b) =>
    String(a.id ?? '').localeCompare(String(b.id ?? ''), undefined, { numeric: true, sensitivity: 'base' });

  const normalizeTextKey = (v) =>
    String(v == null ? '' : v)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  const keysMatchLoose = (a, b) => {
    const x = normalizeTextKey(a);
    const y = normalizeTextKey(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x);
  };

  function productCategoryKey(p) {
    const keys = [
      p?.categoryEn,
      p?.category,
      p?.categoryAr,
      p?.categoryName,
      p?.subCategoryEn,
      p?.subCategory,
      p?.subCategoryAr,
    ]
      .map(normalizeTextKey)
      .filter(Boolean);
    return keys.length ? keys[0] : '';
  }

  /** Buckets products under store.storeCategories (+ other). Same matching as paged-categories. */
  function buildStoreCategoryBuckets(store, storeProducts) {
    const storeCategories = Array.isArray(store.storeCategories) ? store.storeCategories : [];
    const categoriesForPaging = [
      ...storeCategories.map((c, idx) => {
        const img =
          typeof c?.image === 'string' && String(c.image).trim() !== ''
            ? String(c.image).trim()
            : typeof c?.imageUrl === 'string' && String(c.imageUrl).trim() !== ''
              ? String(c.imageUrl).trim()
              : null;
        return {
          id: c?.id != null ? String(c.id) : `cat_${idx + 1}`,
          nameEn: c?.nameEn ?? '',
          nameAr: c?.nameAr ?? '',
          name: c?.name ?? '',
          ...(img ? { image: img } : {}),
        };
      }),
      { id: 'other', nameEn: 'Other', nameAr: 'أخرى', name: 'Other' },
    ];

    const categoryMatchers = categoriesForPaging.map((c) => ({
      cat: c,
      keys: new Set([c.id, c.nameEn, c.nameAr, c.name].map(normalizeTextKey).filter(Boolean)),
    }));

    const buckets = new Map(categoryMatchers.map((x) => [x.cat.id, []]));
    for (const p of storeProducts) {
      const pKeys = new Set(
        [
          p?.categoryEn,
          p?.category,
          p?.categoryAr,
          p?.categoryName,
          p?.subCategoryEn,
          p?.subCategory,
          p?.subCategoryAr,
        ].map(normalizeTextKey).filter(Boolean),
      );
      let matchedId = 'other';
      for (const m of categoryMatchers) {
        if (m.cat.id === 'other') continue;
        for (const pk of pKeys) {
          for (const ck of m.keys) {
            if (keysMatchLoose(pk, ck)) {
              matchedId = m.cat.id;
              break;
            }
          }
          if (matchedId !== 'other') break;
        }
        if (matchedId !== 'other') break;
      }
      buckets.get(matchedId).push(p);
    }
    return { categoriesForPaging, buckets };
  }

  /**
   * Flat pagination: each page contains up to `perPage` items total (not per category).
   * Items are taken round-robin across categories so every category gets representation.
   */
  function pickFlatPageSlice(buckets, page, perPage) {
    const keys = Array.from(buckets.keys());
    const totalProducts = keys.reduce((sum, k) => sum + (buckets.get(k)?.length || 0), 0);
    const totalPages = totalProducts > 0 ? Math.ceil(totalProducts / perPage) : 0;
    const emptyPick = () => new Map(keys.map((k) => [k, []]));

    if (totalProducts === 0) {
      return { pagePick: emptyPick(), finished: true, totalProducts: 0, totalPages: 0 };
    }
    if (page > totalPages) {
      return { pagePick: emptyPick(), finished: true, totalProducts, totalPages };
    }

    const allFlat = [];
    const pointers = new Map(keys.map((k) => [k, 0]));
    let active = keys.filter((k) => (buckets.get(k)?.length || 0) > 0);
    while (active.length > 0) {
      const nextActive = [];
      for (const k of active) {
        const list = buckets.get(k) || [];
        const ptr = pointers.get(k) || 0;
        if (ptr < list.length) {
          allFlat.push({ key: k, item: list[ptr] });
          pointers.set(k, ptr + 1);
          if (ptr + 1 < list.length) nextActive.push(k);
        }
      }
      active = nextActive;
    }

    const start = (page - 1) * perPage;
    const slice = allFlat.slice(start, start + perPage);

    const pagePick = emptyPick();
    for (const { key, item } of slice) {
      pagePick.get(key).push(item);
    }

    const finished = start + perPage >= allFlat.length;
    return { pagePick, finished, totalProducts, totalPages };
  }

  /**
   * Paginated store products — same category logic as `/products/paged-categories`:
   * all store categories (+ other) every response, up to 10 items per category per page.
   * `data.products` is a flattened list of that page (backward compatible for clients that only read `products`).
   */
  app.get('/api/stores/:id/products/paged', (req, res) => {
    const storeId = req.params.id;
    const storesResponse = loadStoresResponse();
    const storesList = storesResponse?.data?.stores ?? [];
    const store = storesList.find((s) => String(s.id) === String(storeId));
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    if (!isStoreListedForCustomerBrowse(store)) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const pageRaw = req.query.page != null ? String(req.query.page).trim() : '1';
    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const perPage = 10;

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
    const storeProducts = products
      .filter((p) => String(p.store?.id) === String(storeId) && p.isAvailable !== false)
      .sort(compareProductIdStable);

    const toClientProduct = (p) => {
      const { price, originalPrice } = applyCatalogListPriceAndOriginal(p);
      return {
        ...p,
        price,
        originalPrice,
        discount: p.discount ?? null,
        store: p.store ? { ...p.store, isOpen: customerFacingIsOpen(store) } : p.store,
      };
    };

    const { categoriesForPaging, buckets } = buildStoreCategoryBuckets(store, storeProducts);
    const { pagePick, finished, totalProducts, totalPages } = pickFlatPageSlice(buckets, page, perPage);

    const categoriesOut = categoriesForPaging.map((c) => {
      const total = buckets.get(c.id)?.length || 0;
      const items = (pagePick.get(c.id) || []).map(toClientProduct);
      return { ...c, total, items };
    });

    const flatProducts = categoriesForPaging.flatMap((c) => (pagePick.get(c.id) || []).map(toClientProduct));

    return res.status(200).json({
      success: true,
      message: 'Store products page retrieved successfully',
      data: {
        store: storePayloadForProductRoutes(store),
        products: flatProducts,
        categories: categoriesOut,
        pagination: {
          page,
          perPage,
          total: totalProducts,
          totalPages,
          hasNextPage: totalPages > 0 && page < totalPages,
          hasPrevPage: page > 1 && totalProducts > 0,
          finished,
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Paginated store products by store categories.
   *
   * Returns ALL `store.storeCategories` (plus an `other` bucket).
   * Each page returns up to 10 items total (flat), distributed round-robin across categories.
   *
   * Response shape:
   * - `data.categories`: array of categories with `{ id, nameEn, nameAr, name, items, total }`
   * - `data.pagination`: `{ page, perPage, totalProducts, finished }`
   */
  app.get('/api/stores/:id/products/paged-categories', (req, res) => {
    const storeId = req.params.id;
    const storesResponse = loadStoresResponse();
    const storesList = storesResponse?.data?.stores ?? [];
    const store = storesList.find((s) => String(s.id) === String(storeId));
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    if (!isStoreListedForCustomerBrowse(store)) return res.status(404).json({ success: false, message: 'Store not found' });

    const pageRaw = req.query.page != null ? String(req.query.page).trim() : '1';
    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const perPage = 10;

    const productsResponsePath = getJsonPath('products_listing_response.json');
    let productsResponse;
    try {
      const raw = fs.readFileSync(productsResponsePath, 'utf-8');
      productsResponse = JSON.parse(raw);
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Products payload is unavailable' });
    }
    if (!productsResponse) return res.status(500).json({ success: false, message: 'Products payload is unavailable' });

    const storeCategories = Array.isArray(store.storeCategories) ? store.storeCategories : [];

    const products = productsResponse?.data?.products ?? [];
    const storeProducts = products
      .filter((p) => String(p.store?.id) === String(storeId) && p.isAvailable !== false)
      .sort(compareProductIdStable);

    const toClientProduct = (p) => {
      const { price, originalPrice } = applyCatalogListPriceAndOriginal(p);
      return {
        ...p,
        price,
        originalPrice,
        discount: p.discount ?? null,
        store: p.store ? { ...p.store, isOpen: customerFacingIsOpen(store) } : p.store,
      };
    };

    const { categoriesForPaging, buckets } = buildStoreCategoryBuckets(store, storeProducts);
    const { pagePick, finished, totalProducts, totalPages } = pickFlatPageSlice(buckets, page, perPage);

    const categoriesOut = categoriesForPaging.map((c) => {
      const total = buckets.get(c.id)?.length || 0;
      const items = (pagePick.get(c.id) || []).map(toClientProduct);
      return { ...c, total, items };
    });

    return res.status(200).json({
      success: true,
      message: 'Store products categories page retrieved successfully',
      data: {
        store: storePayloadForProductRoutes(store),
        categories: categoriesOut,
        pagination: {
          page,
          perPage,
          total: totalProducts,
          totalPages,
          hasNextPage: totalPages > 0 && page < totalPages,
          hasPrevPage: page > 1 && totalProducts > 0,
          totalProducts,
          finished,
        },
      },
      timestamp: new Date().toISOString(),
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
    const store = storesList.find((s) => String(s.id) === String(storeId));
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    if (!isStoreListedForCustomerBrowse(store)) {
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
    const storeProducts = products.filter((p) => String(p.store?.id) === String(storeId) && p.isAvailable !== false);

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
    const toClientProduct = (p) => {
      const { price, originalPrice } = applyCatalogListPriceAndOriginal(p);
      return {
        ...p,
        price,
        originalPrice,
        discount: p.discount ?? null,
        store: p.store ? { ...p.store, isOpen: customerFacingIsOpen(store) } : p.store,
      };
    };

    return res.status(200).json({
      success: true,
      message: 'Store products by category retrieved successfully',
      data: {
        store: storePayloadForProductRoutes(store),
        categoryName: categoryName,
        subCategory: subCategoryQuery || null,
        products: filteredProducts.map(toClientProduct),
        count: filteredProducts.length
      },
      timestamp: new Date().toISOString()
    });
  });
};

