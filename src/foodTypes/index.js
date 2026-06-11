const fs = require('fs');
const path = require('path');
const { getJsonPath } = require('../config/jsonPaths');

const foodTypesResponsePath = getJsonPath('food_types_response.json');

/**
 * Food types are a cross-cutting taxonomy of what a store sells (e.g. Shawarma, Burger,
 * Arabic Cuisine). Admins manage the list (with an image per type); each store selects
 * one or more by id. Stored in a single JSON file, mirroring categories/stores.
 */
const DEFAULT_FOOD_TYPES = [
  { id: '1', name: 'shawarma', nameEn: 'Shawarma', nameAr: 'شاورما', image: '', displayOrder: 1 },
  { id: '2', name: 'burger', nameEn: 'Burger', nameAr: 'برجر', image: '', displayOrder: 2 },
  { id: '3', name: 'arabic_cuisine', nameEn: 'Arabic Cuisine', nameAr: 'مطبخ عربي', image: '', displayOrder: 3 },
];

function loadFoodTypes() {
  try {
    if (!fs.existsSync(foodTypesResponsePath)) {
      const dir = path.dirname(foodTypesResponsePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        foodTypesResponsePath,
        JSON.stringify({ success: true, message: 'Food types', data: { foodTypes: DEFAULT_FOOD_TYPES } }, null, 2),
        'utf-8',
      );
    }
    const raw = fs.readFileSync(foodTypesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    const list = data?.data?.foodTypes;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveFoodTypes(foodTypes) {
  let data;
  try {
    const raw = fs.readFileSync(foodTypesResponsePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    data = { success: true, message: 'Food types', data: {} };
  }
  data.data = data.data || {};
  data.data.foodTypes = foodTypes;
  const dir = path.dirname(foodTypesResponsePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(foodTypesResponsePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sortFoodTypes(list) {
  return [...(list || [])].sort((a, b) => {
    const ao = Number(a.displayOrder ?? a.order ?? 0);
    const bo = Number(b.displayOrder ?? b.order ?? 0);
    if (ao !== bo) return ao - bo;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  });
}

/** Public/consistent shape for a single food type. */
function publicFoodType(ft) {
  if (!ft) return null;
  return {
    id: String(ft.id),
    name: ft.name ?? ft.nameEn ?? '',
    nameEn: ft.nameEn ?? ft.name ?? '',
    nameAr: ft.nameAr ?? ft.name ?? '',
    image: ft.image ?? '',
    displayOrder: Number(ft.displayOrder ?? ft.order ?? 0),
  };
}

// mtime-based cache so per-store resolution in store listings does not re-read the file each call.
let _cache = { mtimeMs: -1, byId: {} };

function buildByIdMap(list) {
  const byId = {};
  for (const ft of list) {
    const pub = publicFoodType(ft);
    if (pub) byId[pub.id] = pub;
  }
  return byId;
}

function getFoodTypesByIdMap() {
  try {
    const stat = fs.statSync(foodTypesResponsePath);
    if (stat.mtimeMs !== _cache.mtimeMs) {
      _cache = { mtimeMs: stat.mtimeMs, byId: buildByIdMap(loadFoodTypes()) };
    }
    return _cache.byId;
  } catch (e) {
    // File missing — loadFoodTypes() will seed it; rebuild without caching the (unknown) mtime.
    return buildByIdMap(loadFoodTypes());
  }
}

/**
 * Resolve a store's selected food type ids (array of strings or objects) into full public
 * food type objects, dropping ids that no longer exist. Used by public store listings.
 */
function resolveStoreFoodTypes(store) {
  const raw = Array.isArray(store?.foodTypes) ? store.foodTypes : [];
  if (raw.length === 0) return [];
  const byId = getFoodTypesByIdMap();
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const id = entry != null && typeof entry === 'object' ? String(entry.id) : String(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (byId[id]) out.push(byId[id]);
  }
  return out;
}

function attachFoodTypesRoutes(app) {
  // Ensure the JSON file is seeded on startup so the app/test client always have data.
  loadFoodTypes();

  app.get('/api/food-types', (req, res) => {
    const foodTypes = sortFoodTypes(loadFoodTypes()).map(publicFoodType);
    return res.status(200).json({
      success: true,
      message: 'Food types retrieved successfully',
      data: { foodTypes },
      timestamp: new Date().toISOString(),
    });
  });
}

module.exports = attachFoodTypesRoutes;
module.exports.loadFoodTypes = loadFoodTypes;
module.exports.saveFoodTypes = saveFoodTypes;
module.exports.sortFoodTypes = sortFoodTypes;
module.exports.publicFoodType = publicFoodType;
module.exports.resolveStoreFoodTypes = resolveStoreFoodTypes;
module.exports.getFoodTypesByIdMap = getFoodTypesByIdMap;
module.exports.foodTypesResponsePath = foodTypesResponsePath;
