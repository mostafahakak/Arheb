const fs = require('fs');
const path = require('path');

const homeResponsePath = path.resolve(
  __dirname,
  '..',
  '..',
  'Arheb API JSON',
  'home_response.json'
);

const loadHomeResponse = () => {
  try {
    const raw = fs.readFileSync(homeResponsePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load home response', error);
    return null;
  }
};

const homeResponse = loadHomeResponse();
const banners = homeResponse?.data?.banners ?? [];
const homeCategories = homeResponse?.data?.categories ?? [];
const mostPopularStores = homeResponse?.data?.mostPopularStores ?? [];
const offers = homeResponse?.data?.offers ?? [];

const toInt = (value) => (value ? 1 : 0);

const seedHomeTables = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_banners (
      id TEXT PRIMARY KEY,
      image TEXT,
      title TEXT,
      link TEXT,
      displayOrder INTEGER
    );

    CREATE TABLE IF NOT EXISTS home_categories (
      id TEXT PRIMARY KEY,
      name TEXT,
      nameAr TEXT,
      nameEn TEXT,
      image TEXT,
      isComingSoon INTEGER,
      displayOrder INTEGER
    );

    CREATE TABLE IF NOT EXISTS home_stores (
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
      minimumOrder REAL
    );

    CREATE TABLE IF NOT EXISTS home_offers (
      id TEXT PRIMARY KEY,
      image TEXT,
      title TEXT,
      titleAr TEXT,
      titleEn TEXT,
      description TEXT,
      descriptionAr TEXT,
      descriptionEn TEXT,
      link TEXT,
      validUntil TEXT,
      displayOrder INTEGER
    );
  `);

  const insertBanner = db.prepare(`
    INSERT INTO home_banners (id, image, title, link, displayOrder)
    VALUES (@id, @image, @title, @link, @displayOrder)
    ON CONFLICT(id) DO UPDATE SET
      image = excluded.image,
      title = excluded.title,
      link = excluded.link,
      displayOrder = excluded.displayOrder
  `);

  const insertCategory = db.prepare(`
    INSERT INTO home_categories (id, name, nameAr, nameEn, image, isComingSoon, displayOrder)
    VALUES (@id, @name, @nameAr, @nameEn, @image, @isComingSoon, @displayOrder)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      nameAr = excluded.nameAr,
      nameEn = excluded.nameEn,
      image = excluded.image,
      isComingSoon = excluded.isComingSoon,
      displayOrder = excluded.displayOrder
  `);

  const insertStore = db.prepare(`
    INSERT INTO home_stores (
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
      minimumOrder
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
      @minimumOrder
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
      minimumOrder = excluded.minimumOrder
  `);

  const insertOffer = db.prepare(`
    INSERT INTO home_offers (
      id,
      image,
      title,
      titleAr,
      titleEn,
      description,
      descriptionAr,
      descriptionEn,
      link,
      validUntil,
      displayOrder
    ) VALUES (
      @id,
      @image,
      @title,
      @titleAr,
      @titleEn,
      @description,
      @descriptionAr,
      @descriptionEn,
      @link,
      @validUntil,
      @displayOrder
    )
    ON CONFLICT(id) DO UPDATE SET
      image = excluded.image,
      title = excluded.title,
      titleAr = excluded.titleAr,
      titleEn = excluded.titleEn,
      description = excluded.description,
      descriptionAr = excluded.descriptionAr,
      descriptionEn = excluded.descriptionEn,
      link = excluded.link,
      validUntil = excluded.validUntil,
      displayOrder = excluded.displayOrder
  `);

  const insertData = db.transaction(() => {
    let bannerOrder = 0;
    for (const banner of banners) {
      bannerOrder += 1;
      insertBanner.run({
        id: banner.id,
        image: banner.image ?? null,
        title: banner.title ?? null,
        link: banner.link ?? null,
        displayOrder: banner.order ?? bannerOrder,
      });
    }

    let categoryOrder = 0;
    for (const category of homeCategories) {
      categoryOrder += 1;
      insertCategory.run({
        id: category.id,
        name: category.name ?? null,
        nameAr: category.nameAr ?? null,
        nameEn: category.nameEn ?? null,
        image: category.image ?? null,
        isComingSoon: toInt(category.isComingSoon),
        displayOrder: category.order ?? categoryOrder,
      });
    }

    for (const store of mostPopularStores) {
      insertStore.run({
        id: store.id,
        name: store.name ?? null,
        nameAr: store.nameAr ?? null,
        nameEn: store.nameEn ?? null,
        cover: store.cover ?? null,
        logo: store.logo ?? null,
        rate: typeof store.rate === 'number' ? store.rate : null,
        numberOfReviews: store.numberOfReviews ?? null,
        isFavorite: toInt(store.isFavorite),
        deliveryTime: store.deliveryTime ?? null,
        deliveryFee: typeof store.deliveryFee === 'number' ? store.deliveryFee : null,
        minimumOrder: typeof store.minimumOrder === 'number' ? store.minimumOrder : null,
      });
    }

    let offerOrder = 0;
    for (const offer of offers) {
      offerOrder += 1;
      insertOffer.run({
        id: offer.id,
        image: offer.image ?? null,
        title: offer.title ?? null,
        titleAr: offer.titleAr ?? null,
        titleEn: offer.titleEn ?? null,
        description: offer.description ?? null,
        descriptionAr: offer.descriptionAr ?? null,
        descriptionEn: offer.descriptionEn ?? null,
        link: offer.link ?? null,
        validUntil: offer.validUntil ?? null,
        displayOrder: offer.order ?? offerOrder,
      });
    }
  });

  insertData();
};

module.exports = function attachHomeRoutes(app, db) {
  if (banners.length || homeCategories.length || mostPopularStores.length || offers.length) {
    seedHomeTables(db);
  } else {
    console.warn('No home data found to seed the database');
  }

  app.get('/api/home', (req, res) => {
    if (!homeResponse) {
      return res.status(500).json({ message: 'Home payload is unavailable' });
    }

    return res.status(200).json(homeResponse);
  });
};

