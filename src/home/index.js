const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getJsonPath } = require('../config/jsonPaths');
const {
  isStoreListedForCustomerBrowse,
  getAdminStoreDashboardBucket,
} = require('../utils/storeVisibility');
const { normalizeHomeContentLinkArray } = require('../utils/homeContentLinks');

function loadStoresListForVisibility() {
  try {
    const filePath = getJsonPath('stores_listing_response.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.stores ?? [];
  } catch (e) {
    return [];
  }
}

function loadDiscountedProducts() {
  try {
    const filePath = getJsonPath('products_listing_response.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const products = (data?.data?.products ?? []).filter((p) => p.isAvailable !== false);
    const hasDiscount = (p) => {
      const d = p.discount;
      if (d == null || d === '') return false;
      if (typeof d === 'number') return d > 0;
      const n = parseFloat(String(d).replace(/%/g, ''), 10);
      return !Number.isNaN(n) && n > 0;
    };
    return products.filter(hasDiscount);
  } catch (e) {
    return [];
  }
}

const loadHomeResponse = () => {
  try {
    const filePath = getJsonPath('home_response.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load home response:', error.message);
    return null;
  }
};

const loadCategoriesResponse = () => {
  try {
    const filePath = getJsonPath('categories_response.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.categories ?? [];
  } catch (error) {
    return null;
  }
};

/** Minimal payload when home_response.json is missing (e.g. first deploy with persistent disk). */
const EMPTY_HOME_PAYLOAD = {
  success: true,
  message: 'Home data retrieved successfully',
  data: {
    banners: [],
    categories: [],
    mostPopularStores: [],
    offers: [],
    discountedProducts: [],
  },
};

const toInt = (value) => (value ? 1 : 0);

const seedHomeTables = (db, homeResponse) => {
  const banners = homeResponse?.data?.banners ?? [];
  const homeCategories = homeResponse?.data?.categories ?? [];
  const mostPopularStores = homeResponse?.data?.mostPopularStores ?? [];
  const offers = homeResponse?.data?.offers ?? [];
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
  try {
    db.exec('ALTER TABLE home_banners ADD COLUMN linkTarget TEXT');
  } catch (e) {
    /* column exists */
  }
  try {
    db.exec('ALTER TABLE home_banners ADD COLUMN linkTargetId TEXT');
  } catch (e) {
    /* column exists */
  }
  try {
    db.exec('ALTER TABLE home_offers ADD COLUMN linkTarget TEXT');
  } catch (e) {
    /* column exists */
  }
  try {
    db.exec('ALTER TABLE home_offers ADD COLUMN linkTargetId TEXT');
  } catch (e) {
    /* column exists */
  }

  const insertBanner = db.prepare(`
    INSERT INTO home_banners (id, image, title, link, displayOrder, linkTarget, linkTargetId)
    VALUES (@id, @image, @title, @link, @displayOrder, @linkTarget, @linkTargetId)
    ON CONFLICT(id) DO UPDATE SET
      image = excluded.image,
      title = excluded.title,
      link = excluded.link,
      displayOrder = excluded.displayOrder,
      linkTarget = excluded.linkTarget,
      linkTargetId = excluded.linkTargetId
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
      displayOrder,
      linkTarget,
      linkTargetId
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
      @displayOrder,
      @linkTarget,
      @linkTargetId
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
      displayOrder = excluded.displayOrder,
      linkTarget = excluded.linkTarget,
      linkTargetId = excluded.linkTargetId
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
        linkTarget: banner.linkTarget === 'product' || banner.linkTarget === 'category' ? banner.linkTarget : null,
        linkTargetId: banner.linkTargetId != null && String(banner.linkTargetId).trim() !== '' ? String(banner.linkTargetId).trim() : null,
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
        linkTarget: offer.linkTarget === 'product' || offer.linkTarget === 'category' ? offer.linkTarget : null,
        linkTargetId: offer.linkTargetId != null && String(offer.linkTargetId).trim() !== '' ? String(offer.linkTargetId).trim() : null,
      });
    }
  });

  insertData();
};

const ACTIVE_ORDER_STATUSES = ['Waiting confirmation', 'Waiting cliq confirmation', 'Being prepared', 'On the way'];

module.exports = function attachHomeRoutes(app, db, JWT_SECRET) {
  const initialHome = loadHomeResponse();
  const banners = initialHome?.data?.banners ?? [];
  const homeCategories = initialHome?.data?.categories ?? [];
  const mostPopularStores = initialHome?.data?.mostPopularStores ?? [];
  const offers = initialHome?.data?.offers ?? [];
  if (banners.length || homeCategories.length || mostPopularStores.length || offers.length) {
    seedHomeTables(db, initialHome);
  } else {
    console.warn('No home data found to seed the database');
  }

  const findActiveOrderByPhone = db.prepare(`
    SELECT id, status FROM orders
    WHERE phoneNumber = ? AND status IN (?, ?, ?, ?)
    ORDER BY createdAt DESC LIMIT 1
  `);

  app.get('/api/home', (req, res) => {
    const homeResponse = loadHomeResponse();
    const response = homeResponse
      ? { ...homeResponse }
      : { ...EMPTY_HOME_PAYLOAD };

    if (response.data) {
      const d = response.data;
      if (Array.isArray(d.banners)) {
        d.banners = normalizeHomeContentLinkArray(d.banners);
      }
      if (Array.isArray(d.offers)) {
        d.offers = normalizeHomeContentLinkArray(d.offers);
      }
    }

    // Use categories from categories_response.json (single source of truth)
    const categories = loadCategoriesResponse();
    if (response.data && categories) {
      response.data = { ...response.data, categories };
    }

    // Discounted products (offers): products that have a discount (ensure discount/originalPrice for client)
    const discountedProducts = loadDiscountedProducts().map((p) => ({
      ...p,
      discount: p.discount ?? null,
      originalPrice: p.originalPrice ?? p.price ?? null,
    }));
    if (response.data) {
      response.data = { ...response.data, discountedProducts };
    }

    const storesForVisibility = loadStoresListForVisibility();
    const storeByIdMap = Object.fromEntries(storesForVisibility.map((s) => [String(s.id), s]));
    const listedStoreIds = new Set(
      storesForVisibility.filter((s) => isStoreListedForCustomerBrowse(s)).map((s) => String(s.id)),
    );
    if (response.data?.mostPopularStores?.length) {
      response.data.mostPopularStores = response.data.mostPopularStores
        .filter((s) => s && s.id != null && listedStoreIds.has(String(s.id)))
        .map((s) => {
          const fullStore = storeByIdMap[String(s.id)];
          const status = fullStore ? getAdminStoreDashboardBucket(fullStore) : 'closed';
          return { ...s, status };
        });
    }

    // If user is authenticated, add activeOrder (orderID, status) only when they have an order in active status
    if (JWT_SECRET) {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.replace(/Bearer\s+/i, '').trim();
      if (token) {
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          const phoneNumber = payload.phoneNumber;
          if (phoneNumber) {
            const row = findActiveOrderByPhone.get(phoneNumber, ...ACTIVE_ORDER_STATUSES);
            if (row) {
              response.activeOrder = { orderID: row.id, status: row.status };
            }
          }
        } catch (e) {
          // Invalid token: do not add activeOrder
        }
      }
    }

    return res.status(200).json(response);
  });
};

