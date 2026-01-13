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
};

