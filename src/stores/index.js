const fs = require('fs');
const path = require('path');

const storesResponsePath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'stores_listing_response.json'
);

const loadStoresResponse = () => {
  try {
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load stores response', error);
    return null;
  }
};

const storesResponse = loadStoresResponse();
const storesList = storesResponse?.data?.stores ?? [];

const seedStoresTable = (db, stores) => {
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

module.exports = function attachStoresRoutes(app, db) {
  if (storesList.length > 0) {
    seedStoresTable(db, storesList);
  } else {
    console.warn('No store data found to seed the database');
  }

  app.get('/api/stores', (req, res) => {
    if (!storesResponse) {
      return res.status(500).json({ message: 'Stores payload is unavailable' });
    }

    return res.status(200).json(storesResponse);
  });

  app.get('/api/stores/top-rated', (req, res) => {
    if (!storesResponse || storesList.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Stores payload is unavailable'
      });
    }

    // Get optional limit parameter (default to all stores if not specified)
    const limit = req.query.limit ? parseInt(req.query.limit) : null;

    // Filter stores that have a valid rate and sort by rate (highest first)
    const topRatedStores = storesList
      .filter(store => store.rate != null && typeof store.rate === 'number')
      .sort((a, b) => {
        // Sort by rate descending (highest first)
        // If rates are equal, sort by number of reviews (more reviews first)
        if (b.rate !== a.rate) {
          return b.rate - a.rate;
        }
        return (b.numberOfReviews || 0) - (a.numberOfReviews || 0);
      })
      .slice(0, limit || storesList.length); // Apply limit if specified

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
    if (!storesResponse || storesList.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Stores payload is unavailable'
      });
    }
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

  // Get stores by category name
  app.get('/api/stores/category/:categoryName', (req, res) => {
    const categoryName = req.params.categoryName;
    if (!categoryName || categoryName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }
    if (!storesResponse || storesList.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Stores payload is unavailable'
      });
    }
    const categoryNameLower = categoryName.toLowerCase().trim();
    const matches = (val) => {
      if (val == null) return false;
      const s = String(val).toLowerCase();
      return s === categoryNameLower || s.includes(categoryNameLower) || categoryNameLower.includes(s);
    };
    const storesByCategory = storesList.filter(store =>
      matches(store.category) || matches(store.categoryAr) || matches(store.categoryEn)
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

  app.get('/api/stores/:id/products', (req, res) => {
    const storeId = req.params.id;

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

    // Check if store exists in stores listing
    const store = storesList.find(s => s.id === storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Filter products by store ID
    const products = productsResponse?.data?.products ?? [];
    const storeProducts = products.filter(p => p.store?.id === storeId);

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
          cover: store.cover
        },
        products: storeProducts,
        count: storeProducts.length
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/stores/:id/products/category/:categoryName', (req, res) => {
    const storeId = req.params.id;
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

    // Check if store exists in stores listing
    const store = storesList.find(s => s.id === storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Filter products by store ID and category
    const products = productsResponse?.data?.products ?? [];
    
    // Filter by store ID first
    const storeProducts = products.filter(p => p.store?.id === storeId);
    
    // Then filter by category name (check product category or store category)
    // Case-insensitive comparison for category name
    const categoryNameLower = categoryName.toLowerCase().trim();
    const filteredProducts = storeProducts.filter(p => {
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
      if (store.category) {
        const storeCategory = String(store.category).toLowerCase();
        if (storeCategory === categoryNameLower || 
            storeCategory.includes(categoryNameLower) ||
            categoryNameLower.includes(storeCategory)) {
          return true;
        }
      }
      
      if (store.categoryAr) {
        const storeCatAr = String(store.categoryAr).toLowerCase();
        if (storeCatAr === categoryNameLower || 
            storeCatAr.includes(categoryNameLower) ||
            categoryNameLower.includes(storeCatAr)) {
          return true;
        }
      }
      
      if (store.categoryEn) {
        const storeCatEn = String(store.categoryEn).toLowerCase();
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
          categoryEn: store.categoryEn
        },
        categoryName: categoryName,
        products: filteredProducts,
        count: filteredProducts.length
      },
      timestamp: new Date().toISOString()
    });
  });
};

