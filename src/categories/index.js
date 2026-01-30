const fs = require('fs');
const path = require('path');

const categoriesResponsePath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'categories_response.json'
);

const loadCategoriesResponse = () => {
  try {
    const raw = fs.readFileSync(categoriesResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load categories response', error);
    return null;
  }
};

const categoriesResponse = loadCategoriesResponse();
const categoriesList = categoriesResponse?.data?.categories ?? [];

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
    let sortOrder = 0;
    for (const category of items) {
      sortOrder += 1;
      insertCategory.run({
        id: category.id,
        name: category.name,
        nameAr: category.nameAr,
        nameEn: category.nameEn,
        image: category.image,
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
          id: subcategory.id,
          categoryId: category.id,
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

module.exports = function attachCategoriesRoutes(app, db) {
  if (categoriesList.length > 0) {
    seedCategoriesTables(db, categoriesList);
  } else {
    console.warn('No categories data found to seed the database');
  }

  app.get('/api/categories', (req, res) => {
    if (!categoriesResponse) {
      return res.status(500).json({ message: 'Categories payload is unavailable' });
    }

    return res.status(200).json(categoriesResponse);
  });

  app.get('/api/categories/:categoryName/products', (req, res) => {
    const categoryName = req.params.categoryName;

    if (!categoryName || categoryName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Load products response
    const productsResponsePath = path.resolve(
      __dirname,
      '..',
      '..',
      'Arheb API JSON',
      'products_listing_response.json'
    );

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
