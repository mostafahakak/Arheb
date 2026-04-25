const fs = require('fs');
const path = require('path');
const { getJsonPath } = require('../config/jsonPaths');
const {
  isStoreVisibleToCustomers,
  isStoreListedForCustomerBrowse,
  customerFacingIsOpen,
  loadStoresByIdMap,
} = require('../utils/storeVisibility');
const { applyCatalogListPriceAndOriginal } = require('../utils/productCatalogPrice');

const categoriesResponsePath = getJsonPath('categories_response.json');

const loadCategoriesResponse = () => {
  try {
    const raw = fs.readFileSync(categoriesResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load categories response (using fallback):', error.message);
    return null;
  }
};

function loadStoreStatusMap() {
  try {
    const storesPath = getJsonPath('stores_listing_response.json');
    const raw = fs.readFileSync(storesPath, 'utf-8');
    const stores = JSON.parse(raw)?.data?.stores ?? [];
    const map = {};
    for (const s of stores) {
      if (!s) continue;
      if (s.paused === true) { map[s.id] = 'paused'; }
      else if (isStoreVisibleToCustomers(s)) { map[s.id] = 'open'; }
      else { map[s.id] = 'closed'; }
    }
    return map;
  } catch (e) {
    return {};
  }
}

function enrichProductWithStoreStatus(product, statusMap, storeById) {
  if (!product || !statusMap) return product;
  const { price, originalPrice } = applyCatalogListPriceAndOriginal(product);
  const base = { ...product, price, originalPrice };
  if (!product.store) return base;
  const full = storeById?.[String(product.store.id)];
  return {
    ...base,
    store: {
      ...product.store,
      status: statusMap[product.store.id] ?? 'closed',
      isOpen: full ? customerFacingIsOpen(full) : false,
    },
  };
}

/** Minimal default when JSON file is missing (e.g. on Render after deploy). */
const FALLBACK_CATEGORIES = [
  { id: '1', name: 'General', nameAr: 'عام', nameEn: 'General', image: '', isComingSoon: false, order: 1, subCategories: [] },
];

const toInt = (value) => (value ? 1 : 0);

const seedCategoriesTables = (db, categories) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nameAr TEXT,
      nameEn TEXT,
      image TEXT,
      iconAr TEXT,
      iconEn TEXT,
      isComingSoon INTEGER DEFAULT 0,
      displayOrder INTEGER
    );
    CREATE TABLE IF NOT EXISTS subcategories (
      id TEXT PRIMARY KEY,
      categoryId TEXT NOT NULL,
      name TEXT NOT NULL,
      nameAr TEXT,
      nameEn TEXT,
      image TEXT,
      isComingSoon INTEGER DEFAULT 0,
      displayOrder INTEGER,
      FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
    );
  `);

  const insertCategory = db.prepare(`
    INSERT INTO categories (id, name, nameAr, nameEn, image, iconAr, iconEn, isComingSoon, displayOrder)
    VALUES (@id, @name, @nameAr, @nameEn, @image, @iconAr, @iconEn, @isComingSoon, @displayOrder)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      nameAr = excluded.nameAr,
      nameEn = excluded.nameEn,
      image = excluded.image,
      iconAr = excluded.iconAr,
      iconEn = excluded.iconEn,
      isComingSoon = excluded.isComingSoon,
      displayOrder = excluded.displayOrder
  `);

  const insertSubcategory = db.prepare(`
    INSERT INTO subcategories (id, categoryId, name, nameAr, nameEn, image, isComingSoon, displayOrder)
    VALUES (@id, @categoryId, @name, @nameAr, @nameEn, @image, @isComingSoon, @displayOrder)
    ON CONFLICT(id) DO UPDATE SET
      categoryId = excluded.categoryId,
      name = excluded.name,
      nameAr = excluded.nameAr,
      nameEn = excluded.nameEn,
      image = excluded.image,
      isComingSoon = excluded.isComingSoon,
      displayOrder = excluded.displayOrder
  `);

  const insertData = db.transaction((items) => {
    db.prepare('DELETE FROM subcategories').run();
    db.prepare('DELETE FROM categories').run();
    let sortOrder = 0;
    for (const category of items) {
      sortOrder += 1;
      const catId = String(category.id);
      insertCategory.run({
        id: catId,
        name: category.name ?? '',
        nameAr: category.nameAr ?? null,
        nameEn: category.nameEn ?? null,
        image: category.image ?? null,
        iconAr: category.iconAr ?? null,
        iconEn: category.iconEn ?? null,
        isComingSoon: toInt(category.isComingSoon),
        displayOrder: category.order ?? sortOrder,
      });

      const subCategories = Array.isArray(category.subCategories)
        ? category.subCategories
        : [];

      let subOrder = 0;
      for (const subcategory of subCategories) {
        subOrder += 1;
        insertSubcategory.run({
          id: String(subcategory.id),
          categoryId: catId,
          name: subcategory.name,
          nameAr: subcategory.nameAr,
          nameEn: subcategory.nameEn,
          image: subcategory.image,
          isComingSoon: toInt(subcategory.isComingSoon),
          displayOrder: subcategory.order ?? subOrder,
        });
      }
    }
  });

  insertData(categories);
};

/** Read categories from database and return API response format */
function loadCategoriesFromDb(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nameAr TEXT,
        nameEn TEXT,
        image TEXT,
        iconAr TEXT,
        iconEn TEXT,
        isComingSoon INTEGER DEFAULT 0,
        displayOrder INTEGER
      );
      CREATE TABLE IF NOT EXISTS subcategories (
        id TEXT PRIMARY KEY,
        categoryId TEXT NOT NULL,
        name TEXT NOT NULL,
        nameAr TEXT,
        nameEn TEXT,
        image TEXT,
        isComingSoon INTEGER DEFAULT 0,
        displayOrder INTEGER,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );
    `);
    try { db.exec('ALTER TABLE categories ADD COLUMN iconAr TEXT'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE categories ADD COLUMN iconEn TEXT'); } catch (e) { /* exists */ }

    const catRows = db.prepare('SELECT * FROM categories ORDER BY displayOrder ASC, id ASC').all();
    const subRows = db.prepare('SELECT * FROM subcategories ORDER BY displayOrder ASC, id ASC').all();
    if (catRows.length === 0) return null;

    const subByCat = {};
    for (const s of subRows) {
      if (!subByCat[s.categoryId]) subByCat[s.categoryId] = [];
      subByCat[s.categoryId].push({
        id: s.id,
        name: s.name,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        image: s.image,
        isComingSoon: Boolean(s.isComingSoon),
        order: s.displayOrder,
      });
    }

    const categories = catRows.map((c) => ({
      id: c.id,
      name: c.name,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      image: c.image,
      iconAr: c.iconAr ?? null,
      iconEn: c.iconEn ?? null,
      isComingSoon: Boolean(c.isComingSoon),
      order: c.displayOrder,
      subCategories: subByCat[c.id] || [],
    }));

    return {
      success: true,
      message: 'Categories data retrieved successfully',
      data: { categories },
    };
  } catch (e) {
    console.error('Failed to load categories from DB', e);
    return null;
  }
}

/** Sync categories array to database (used by admin after save) */
function syncCategoriesToDb(db, categories) {
  seedCategoriesTables(db, categories);
}

function attachCategoriesRoutes(app, db) {
  const initialResponse = loadCategoriesResponse();
  const initialCategories = initialResponse?.data?.categories ?? [];
  const existing = loadCategoriesFromDb(db);
  const hasCategoriesInDb = existing?.data?.categories?.length > 0;

  if (initialCategories.length > 0 && !hasCategoriesInDb) {
    seedCategoriesTables(db, initialCategories);
  } else if (initialCategories.length === 0 && !hasCategoriesInDb) {
    // JSON missing or empty (e.g. Render ephemeral fs): seed fallback so test client / app always have data.
    seedCategoriesTables(db, FALLBACK_CATEGORIES);
  }

  function hasDiscount(p) {
    const d = p.discount;
    if (d == null || d === '') return false;
    if (typeof d === 'number') return d > 0;
    if (typeof d === 'string') return d.trim() !== '' && d.trim() !== '0';
    return false;
  }

  function buildOffersCategory() {
    try {
      const productsPath = getJsonPath('products_listing_response.json');
      const rawProducts = fs.readFileSync(productsPath, 'utf-8');
      const allProducts = JSON.parse(rawProducts)?.data?.products ?? [];
      const storesPath = getJsonPath('stores_listing_response.json');
      const rawStores = fs.readFileSync(storesPath, 'utf-8');
      const allStores = JSON.parse(rawStores)?.data?.stores ?? [];
      const storeByIdOffers = Object.fromEntries(allStores.map((s) => [String(s.id), s]));

      const discounted = allProducts.filter(
        (p) =>
          p.isAvailable !== false &&
          hasDiscount(p) &&
          p.store?.id != null &&
          isStoreListedForCustomerBrowse(storeByIdOffers[String(p.store.id)]),
      );
      if (discounted.length === 0) return null;

      const storeIdsWithOffers = new Set();
      for (const p of discounted) {
        const sid = p.store?.id;
        if (sid != null) storeIdsWithOffers.add(String(sid));
      }

      const statusMap = loadStoreStatusMap();
      const offerStores = allStores
        .filter((s) => storeIdsWithOffers.has(String(s.id)) && isStoreListedForCustomerBrowse(s))
        .map((s) => {
          const { arhebFee, isOpen: _rawOpen, ...rest } = s;
          return {
            ...rest,
            isOpen: customerFacingIsOpen(s),
            status: statusMap[s.id] ?? 'closed',
          };
        });

      return {
        id: 'offers',
        name: 'Offers',
        nameAr: 'العروض',
        nameEn: 'Offers',
        image: '',
        iconAr: null,
        iconEn: null,
        isComingSoon: false,
        order: 0,
        subCategories: [],
        stores: offerStores,
        storesCount: offerStores.length,
        productsCount: discounted.length,
      };
    } catch (e) {
      return null;
    }
  }

  // Prefer database so admin edits (synced to DB) are visible. Never wipe DB when JSON is empty.
  app.get('/api/categories', (req, res) => {
    let categories = null;

    const fromDb = loadCategoriesFromDb(db);
    if (fromDb && fromDb.data && Array.isArray(fromDb.data.categories) && fromDb.data.categories.length > 0) {
      categories = fromDb.data.categories;
    }

    if (!categories) {
      const categoriesResponse = loadCategoriesResponse();
      const jsonCategories = categoriesResponse?.data?.categories ?? [];
      if (Array.isArray(jsonCategories) && jsonCategories.length > 0) {
        categories = jsonCategories;
      }
    }

    if (!categories) {
      seedCategoriesTables(db, FALLBACK_CATEGORIES);
      const afterSeed = loadCategoriesFromDb(db);
      categories = afterSeed?.data?.categories ?? FALLBACK_CATEGORIES;
    }

    const offersCategory = buildOffersCategory();
    if (offersCategory) {
      categories = [offersCategory, ...categories.filter(c => c.id !== 'offers')];
    }

    return res.status(200).json({
      success: true,
      message: 'Categories data retrieved successfully',
      data: { categories },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/categories/:categoryName/products', (req, res) => {
    const categoryName = req.params.categoryName;
    const subCategoryQuery = (req.query.subCategory || '').trim().toLowerCase();

    if (!categoryName || categoryName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    const fromDb = loadCategoriesFromDb(db);
    const categoriesList = fromDb?.data?.categories ?? loadCategoriesResponse()?.data?.categories ?? [];

    const productsResponsePath = getJsonPath('products_listing_response.json');
    let productsResponse;
    try {
      const raw = fs.readFileSync(productsResponsePath, 'utf-8');
      productsResponse = JSON.parse(raw);
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Products payload is unavailable'
      });
    }
    if (!productsResponse) {
      return res.status(500).json({
        success: false,
        message: 'Products payload is unavailable'
      });
    }

    const categoryNameLower = categoryName.toLowerCase().trim();
    const category = categoriesList.find(cat => {
      const catName = String(cat.name || '').toLowerCase();
      const catNameAr = String(cat.nameAr || '').toLowerCase();
      const catNameEn = String(cat.nameEn || '').toLowerCase();
      return catName === categoryNameLower || catName.includes(categoryNameLower) || categoryNameLower.includes(catName) ||
             catNameAr === categoryNameLower || catNameAr.includes(categoryNameLower) || categoryNameLower.includes(catNameAr) ||
             catNameEn === categoryNameLower || catNameEn.includes(categoryNameLower) || categoryNameLower.includes(catNameEn);
    });

    // Match terms: category name + all subcategory names/ids so products in subcategories are included
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
      if (p.store && (match(str(p.store.category)) || match(str(p.store.categoryEn)) || match(str(p.store.categoryAr)))) return true;
      return false;
    };

    const products = (productsResponse?.data?.products ?? []).filter(p => p.isAvailable !== false);
    let filtered = products.filter(p => matchTerms.some(term => productMatchesTerm(p, term)));

    if (subCategoryQuery) {
      filtered = filtered.filter(p => {
        const sub = [p.subCategory, p.subCategoryEn, p.subCategoryAr, p.category, p.categoryEn, p.categoryAr]
          .map(v => (v == null ? '' : String(v).toLowerCase())).filter(Boolean);
        return sub.some(s => s === subCategoryQuery || s.includes(subCategoryQuery) || subCategoryQuery.includes(s));
      });
    }

    const storeById = loadStoresByIdMap();
    filtered = filtered.filter((p) => {
      const sid = p?.store?.id;
      if (sid == null) return false;
      const st = storeById[String(sid)];
      return st && isStoreListedForCustomerBrowse(st);
    });

    const statusMap = loadStoreStatusMap();
    return res.status(200).json({
      success: true,
      message: 'Products by category retrieved successfully',
      data: {
        category: category ? {
          id: category.id,
          name: category.name,
          nameAr: category.nameAr,
          nameEn: category.nameEn,
          image: category.image,
          iconAr: category.iconAr ?? null,
          iconEn: category.iconEn ?? null,
          subCategories: category.subCategories || []
        } : null,
        categoryName: categoryName,
        subCategory: subCategoryQuery || null,
        products: filtered.map(p => enrichProductWithStoreStatus(p, statusMap, storeById)),
        count: filtered.length
      },
      timestamp: new Date().toISOString()
    });
  });
};

module.exports = attachCategoriesRoutes;
module.exports.syncCategoriesToDb = syncCategoriesToDb;
