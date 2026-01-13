const fs = require('fs');
const path = require('path');

const productsResponsePath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'products_listing_response.json'
);

const loadProductsResponse = () => {
  try {
    const raw = fs.readFileSync(productsResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load products response', error);
    return null;
  }
};

const productsResponse = loadProductsResponse();
const productsList = productsResponse?.data?.products ?? [];

const toInt = (value) => (value ? 1 : 0);
const toFloat = (value) => (typeof value === 'number' ? value : null);

const seedProductsTables = (db, products) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
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
      isOpen INTEGER
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nameAr TEXT,
      nameEn TEXT,
      image TEXT,
      price REAL,
      originalPrice REAL,
      discount TEXT,
      unit TEXT,
      unitAr TEXT,
      unitEn TEXT,
      category TEXT,
      categoryAr TEXT,
      categoryEn TEXT,
      description TEXT,
      descriptionAr TEXT,
      descriptionEn TEXT,
      stock INTEGER,
      isAvailable INTEGER,
      storeId TEXT,
      FOREIGN KEY (storeId) REFERENCES stores(id) ON DELETE SET NULL
    );
  `);

  const insertStore = db.prepare(`
    INSERT INTO stores (
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
      isOpen
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
      @isOpen
    ) ON CONFLICT(id) DO UPDATE SET
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
      isOpen = excluded.isOpen
  `);

  const insertProduct = db.prepare(`
    INSERT INTO products (
      id,
      name,
      nameAr,
      nameEn,
      image,
      price,
      originalPrice,
      discount,
      unit,
      unitAr,
      unitEn,
      category,
      categoryAr,
      categoryEn,
      description,
      descriptionAr,
      descriptionEn,
      stock,
      isAvailable,
      storeId
    ) VALUES (
      @id,
      @name,
      @nameAr,
      @nameEn,
      @image,
      @price,
      @originalPrice,
      @discount,
      @unit,
      @unitAr,
      @unitEn,
      @category,
      @categoryAr,
      @categoryEn,
      @description,
      @descriptionAr,
      @descriptionEn,
      @stock,
      @isAvailable,
      @storeId
    ) ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      nameAr = excluded.nameAr,
      nameEn = excluded.nameEn,
      image = excluded.image,
      price = excluded.price,
      originalPrice = excluded.originalPrice,
      discount = excluded.discount,
      unit = excluded.unit,
      unitAr = excluded.unitAr,
      unitEn = excluded.unitEn,
      category = excluded.category,
      categoryAr = excluded.categoryAr,
      categoryEn = excluded.categoryEn,
      description = excluded.description,
      descriptionAr = excluded.descriptionAr,
      descriptionEn = excluded.descriptionEn,
      stock = excluded.stock,
      isAvailable = excluded.isAvailable,
      storeId = excluded.storeId
  `);

  const insertData = db.transaction((items) => {
    for (const product of items) {
      const store = product.store ?? {};
      if (store.id) {
        insertStore.run({
          id: store.id,
          name: store.name ?? '',
          nameAr: store.nameAr ?? '',
          nameEn: store.nameEn ?? '',
          cover: store.cover ?? null,
          logo: store.logo ?? null,
          rate: toFloat(store.rate),
          numberOfReviews: store.numberOfReviews ?? null,
          isFavorite: toInt(store.isFavorite),
          deliveryTime: store.deliveryTime ?? null,
          deliveryFee: toFloat(store.deliveryFee),
          minimumOrder: toFloat(store.minimumOrder),
          isOpen: toInt(store.isOpen),
        });
      }

      insertProduct.run({
        id: product.id,
        name: product.name ?? '',
        nameAr: product.nameAr ?? '',
        nameEn: product.nameEn ?? '',
        image: product.image ?? null,
        price: toFloat(product.price),
        originalPrice: toFloat(product.originalPrice),
        discount: product.discount ?? null,
        unit: product.unit ?? null,
        unitAr: product.unitAr ?? null,
        unitEn: product.unitEn ?? null,
        category: product.category ?? null,
        categoryAr: product.categoryAr ?? null,
        categoryEn: product.categoryEn ?? null,
        description: product.description ?? null,
        descriptionAr: product.descriptionAr ?? null,
        descriptionEn: product.descriptionEn ?? null,
        stock: typeof product.stock === 'number' ? product.stock : null,
        isAvailable: toInt(product.isAvailable),
        storeId: store.id ?? null,
      });
    }
  });

  insertData(products);
};

module.exports = function attachProductsRoutes(app, db) {
  if (productsList.length > 0) {
    seedProductsTables(db, productsList);
  } else {
    console.warn('No products data found to seed the database');
  }

  app.get('/api/products', (req, res) => {
    if (!productsResponse) {
      return res.status(500).json({ message: 'Products payload is unavailable' });
    }

    return res.status(200).json(productsResponse);
  });
};

