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
};
