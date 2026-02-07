const fs = require('fs');
const path = require('path');
const { getJsonPath } = require('../config/jsonPaths');

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
    INSERT INTO categories (id, name, nameAr, nameEn, image, isComingSoon, displayOrder)
    VALUES (@id, @name, @nameAr, @nameEn, @image, @isComingSoon, @displayOrder)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      nameAr = excluded.nameAr,
      nameEn = excluded.nameEn,
      image = excluded.image,
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

  // Prefer database so admin edits (synced to DB) are visible. Never wipe DB when JSON is empty.
  app.get('/api/categories', (req, res) => {
    const fromDb = loadCategoriesFromDb(db);
    if (fromDb && fromDb.data && Array.isArray(fromDb.data.categories) && fromDb.data.categories.length > 0) {
      return res.status(200).json({
        ...fromDb,
        timestamp: fromDb.timestamp || new Date().toISOString(),
      });
    }
    const categoriesResponse = loadCategoriesResponse();
    const jsonCategories = categoriesResponse?.data?.categories ?? [];
    if (Array.isArray(jsonCategories) && jsonCategories.length > 0) {
      return res.status(200).json({
        success: categoriesResponse?.success !== false,
        message: categoriesResponse?.message || 'Categories data retrieved successfully',
        data: { categories: jsonCategories },
        timestamp: categoriesResponse?.timestamp || new Date().toISOString(),
      });
    }
    // Both DB and JSON empty (e.g. first request after deploy): seed fallback and return it.
    seedCategoriesTables(db, FALLBACK_CATEGORIES);
    const afterSeed = loadCategoriesFromDb(db);
    return res.status(200).json({
      success: true,
      message: 'Categories data retrieved successfully',
      data: afterSeed?.data ?? { categories: FALLBACK_CATEGORIES },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/categories/:categoryName/products', (req, res) => {
    const categoryName = req.params.categoryName;

    if (!categoryName || categoryName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    const fromDb = loadCategoriesFromDb(db);
    const categoriesList = fromDb?.data?.categories ?? loadCategoriesResponse()?.data?.categories ?? [];

    // Load products response
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

    // Check if category exists in categories listing
    const categoryNameLower = categoryName.toLowerCase().trim();
    const category = categoriesList.find(cat => {
      const catName = String(cat.name || '').toLowerCase();
      const catNameAr = String(cat.nameAr || '').toLowerCase();
      const catNameEn = String(cat.nameEn || '').toLowerCase();
      
      return catName === categoryNameLower || 
             catName.includes(categoryNameLower) ||
             categoryNameLower.includes(catName) ||
             catNameAr === categoryNameLower || 
             catNameAr.includes(categoryNameLower) ||
             categoryNameLower.includes(catNameAr) ||
             catNameEn === categoryNameLower || 
             catNameEn.includes(categoryNameLower) ||
             categoryNameLower.includes(catNameEn);
    });

    // Filter products by category name
    const products = productsResponse?.data?.products ?? [];
    
    // Filter by category name (check product category or store category)
    const filteredProducts = products.filter(p => {
      // Check if product has a category field
      if (p.category) {
        const productCategory = String(p.category).toLowerCase();
        if (productCategory === categoryNameLower || 
            productCategory.includes(categoryNameLower) ||
            categoryNameLower.includes(productCategory)) {
          return true;
        }
      }
      
      // Check if product category matches any name variant (name, nameAr, nameEn)
      if (p.categoryName) {
        const catName = String(p.categoryName).toLowerCase();
        if (catName === categoryNameLower || 
            catName.includes(categoryNameLower) ||
            categoryNameLower.includes(catName)) {
          return true;
        }
      }
      
      if (p.categoryAr) {
        const catAr = String(p.categoryAr).toLowerCase();
        if (catAr === categoryNameLower || 
            catAr.includes(categoryNameLower) ||
            categoryNameLower.includes(catAr)) {
          return true;
        }
      }
      
      if (p.categoryEn) {
        const catEn = String(p.categoryEn).toLowerCase();
        if (catEn === categoryNameLower || 
            catEn.includes(categoryNameLower) ||
            categoryNameLower.includes(catEn)) {
          return true;
        }
      }
      
      // Check store's category as fallback
      if (p.store?.category) {
        const storeCategory = String(p.store.category).toLowerCase();
        if (storeCategory === categoryNameLower || 
            storeCategory.includes(categoryNameLower) ||
            categoryNameLower.includes(storeCategory)) {
          return true;
        }
      }
      
      if (p.store?.categoryAr) {
        const storeCatAr = String(p.store.categoryAr).toLowerCase();
        if (storeCatAr === categoryNameLower || 
            storeCatAr.includes(categoryNameLower) ||
            categoryNameLower.includes(storeCatAr)) {
          return true;
        }
      }
      
      if (p.store?.categoryEn) {
        const storeCatEn = String(p.store.categoryEn).toLowerCase();
        if (storeCatEn === categoryNameLower || 
            storeCatEn.includes(categoryNameLower) ||
            categoryNameLower.includes(storeCatEn)) {
          return true;
        }
      }
      
      return false;
    });

    return res.status(200).json({
      success: true,
      message: 'Products by category retrieved successfully',
      data: {
        category: category ? {
          id: category.id,
          name: category.name,
          nameAr: category.nameAr,
          nameEn: category.nameEn,
          image: category.image
        } : null,
        categoryName: categoryName,
        products: filteredProducts,
        count: filteredProducts.length
      },
      timestamp: new Date().toISOString()
    });
  });
};

module.exports = attachCategoriesRoutes;
module.exports.syncCategoriesToDb = syncCategoriesToDb;
