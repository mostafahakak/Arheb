const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const {
  hashPassword,
  comparePassword,
  signAdminToken,
  verifyAdminToken,
} = require('./auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const { seedAdmins, ROLES } = require('./seed');
const {
  authenticateAdmin,
  requireRole,
  requireSuperAdmin,
  requireAdminOrSuper,
  requireStoreAccess,
} = require('./middleware');
const { syncCategoriesToDb } = require('../categories');
const { getJsonPath } = require('../config/jsonPaths');
const fcm = require('../fcm');
const { getActiveFromListWithDistance } = require('../driverPresence');

const storesResponsePath = getJsonPath('stores_listing_response.json');
const productsResponsePath = getJsonPath('products_listing_response.json');
const categoriesResponsePath = getJsonPath('categories_response.json');
const popupJsonPath = getJsonPath('popup.json');
const homeJsonPath = getJsonPath('home_response.json');

function loadStores() {
  try {
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.stores ?? [];
  } catch (e) {
    return [];
  }
}

function loadHome() {
  try {
    const raw = fs.readFileSync(homeJsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {
      success: true,
      message: 'Home data retrieved successfully',
      data: {
        banners: [],
        categories: [],
        mostPopularStores: [],
        offers: [],
      },
    };
  }
}

function saveHome(data) {
  try {
    fs.writeFileSync(homeJsonPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    throw new Error('Failed to save home_response.json');
  }
}

function loadProducts() {
  try {
    const raw = fs.readFileSync(productsResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.products ?? [];
  } catch (e) {
    return [];
  }
}

function loadCategories() {
  try {
    const raw = fs.readFileSync(categoriesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.categories ?? [];
  } catch (e) {
    return [];
  }
}

function saveProducts(products) {
  try {
    const raw = fs.readFileSync(productsResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    data.data = data.data || {};
    data.data.products = products;
    fs.writeFileSync(productsResponsePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    throw new Error('Failed to save products');
  }
}

function saveStores(stores) {
  try {
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    data.data = data.data || {};
    data.data.stores = stores;
    fs.writeFileSync(storesResponsePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    throw new Error('Failed to save stores');
  }
}

function saveCategories(categories) {
  try {
    const raw = fs.readFileSync(categoriesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    data.data = data.data || {};
    data.data.categories = categories;
    fs.writeFileSync(categoriesResponsePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    throw new Error('Failed to save categories');
  }
}

function loadPopup() {
  try {
    const raw = fs.readFileSync(popupJsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { image: '', call_of_action_button: '', destination: '', destination_value: '' };
  }
}

function savePopup(data) {
  try {
    fs.writeFileSync(popupJsonPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    throw new Error('Failed to save popup');
  }
}

module.exports = function attachAdminRoutes(app, db, JWT_SECRET) {
  seedAdmins(db);

  const findAdminByEmail = db.prepare('SELECT * FROM admins WHERE email = ?');
  const findAdminById = db.prepare('SELECT * FROM admins WHERE id = ?');
  const findAllAdmins = db.prepare('SELECT id, email, role, storeId, name, createdAt FROM admins ORDER BY id');
  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const findOrderItems = db.prepare('SELECT * FROM order_items WHERE orderId = ?');

  const auth = authenticateAdmin(JWT_SECRET);

  // ——— Login ———
  app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    const admin = findAdminByEmail.get(email.trim().toLowerCase());
    if (!admin || !comparePassword(password, admin.passwordHash)) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    const token = signAdminToken(
      { adminId: admin.id, email: admin.email, role: admin.role, storeId: admin.storeId || null },
      JWT_SECRET
    );
    return res.status(200).json({
      success: true,
      token: `Bearer ${token}`,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        storeId: admin.storeId || null,
        name: admin.name || null,
      },
    });
  });

  // ——— Me (current admin) ———
  app.get('/api/admin/me', auth, (req, res) => {
    const admin = findAdminById.get(req.admin.adminId);
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });
    return res.status(200).json({
      success: true,
      data: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        storeId: admin.storeId || null,
        name: admin.name || null,
      },
    });
  });

  // ——— Admins CRUD (SuperAdmin: all; Admin: cannot create/update/delete SuperAdmin) ———
  app.get('/api/admin/admins', auth, requireAdminOrSuper, (req, res) => {
    const isSuper = req.admin.role === ROLES.SUPERADMIN;
    const rows = findAllAdmins.all();
    const list = isSuper ? rows : rows.filter((r) => r.role !== ROLES.SUPERADMIN);
    return res.status(200).json({ success: true, data: { admins: list } });
  });

  app.post('/api/admin/admins', auth, requireAdminOrSuper, (req, res) => {
    const { email, password, role, storeId, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    if (role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Only SuperAdmin can create SuperAdmin' });
    }
    const allowedRoles = req.admin.role === ROLES.SUPERADMIN
      ? [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.STORE_ADMIN]
      : [ROLES.ADMIN, ROLES.STORE_ADMIN];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    if (role === ROLES.STORE_ADMIN && !storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required for store_admin' });
    }
    const insert = db.prepare(
      'INSERT INTO admins (email, passwordHash, role, storeId, name) VALUES (?, ?, ?, ?, ?)'
    );
    try {
      insert.run(
        email.trim().toLowerCase(),
        hashPassword(password),
        role,
        role === ROLES.STORE_ADMIN ? String(storeId) : null,
        name || null
      );
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(400).json({ success: false, message: 'Email already exists' });
      }
      throw e;
    }
    const created = findAdminByEmail.get(email.trim().toLowerCase());
    return res.status(201).json({
      success: true,
      data: {
        id: created.id,
        email: created.email,
        role: created.role,
        storeId: created.storeId || null,
        name: created.name || null,
        createdAt: created.createdAt,
      },
    });
  });

  app.patch('/api/admin/admins/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const target = findAdminById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Admin not found' });
    if (target.role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Cannot edit SuperAdmin' });
    }
    const { email, password, role, storeId, name } = req.body || {};
    const updates = [];
    const values = [];
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email.trim().toLowerCase());
    }
    if (password !== undefined && password !== '') {
      updates.push('passwordHash = ?');
      values.push(hashPassword(password));
    }
    if (role !== undefined) {
      if (target.role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
        return res.status(403).json({ success: false, message: 'Cannot change SuperAdmin role' });
      }
      if (role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin can set SuperAdmin role' });
      }
      updates.push('role = ?');
      values.push(role);
      updates.push('storeId = ?');
      values.push(role === ROLES.STORE_ADMIN ? (storeId != null ? String(storeId) : target.storeId) : null);
    } else if (storeId !== undefined) {
      updates.push('storeId = ?');
      values.push(target.role === ROLES.STORE_ADMIN ? String(storeId) : null);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name || null);
    }
    if (updates.length === 0) {
      return res.status(200).json({ success: true, data: target });
    }
    values.push(id);
    db.prepare(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const updated = findAdminById.get(id);
    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        storeId: updated.storeId || null,
        name: updated.name || null,
        createdAt: updated.createdAt,
      },
    });
  });

  app.delete('/api/admin/admins/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    if (id === req.admin.adminId) {
      return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }
    const target = findAdminById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Admin not found' });
    if (target.role === ROLES.SUPERADMIN && req.admin.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ success: false, message: 'Cannot delete SuperAdmin' });
    }
    db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    return res.status(200).json({ success: true, message: 'Admin deleted' });
  });

  // ——— Stores ———
  app.get('/api/admin/stores', auth, (req, res) => {
    const stores = loadStores();
    let list = req.admin.role === ROLES.STORE_ADMIN ? stores.filter((s) => s.id === req.admin.storeId) : stores;
    // Admin/SuperAdmin only: filter by isOpen (query param isOpen=true | isOpen=false)
    const isOpenParam = req.query.isOpen;
    if ((req.admin.role === ROLES.ADMIN || req.admin.role === ROLES.SUPERADMIN) && (isOpenParam === 'true' || isOpenParam === 'false')) {
      const open = isOpenParam === 'true';
      list = list.filter((s) => s.isOpen === open);
    }
    if (req.admin.role !== ROLES.SUPERADMIN) {
      list = list.map((s) => { const { arhebFee, ...rest } = s; return rest; });
    }
    return res.status(200).json({ success: true, data: { stores: list } });
  });

  app.post('/api/admin/stores', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const stores = loadStores();
    const ids = stores.map((s) => parseInt(String(s.id), 10)).filter((n) => !isNaN(n));
    const nextId = ids.length ? String(Math.max(...ids) + 1) : '1';
    const openingHours = body.openingHours && typeof body.openingHours === 'object'
      ? body.openingHours
      : { open: body.openingHoursOpen ?? '09:00', close: body.openingHoursClose ?? '23:00' };
    const newStore = {
      id: nextId,
      name: body.name ?? body.nameEn ?? body.nameAr ?? '',
      nameAr: body.nameAr ?? body.name ?? '',
      nameEn: body.nameEn ?? body.name ?? '',
      cover: body.cover ?? '',
      logo: body.logo ?? '',
      rate: typeof body.rate === 'number' ? body.rate : 4,
      numberOfReviews: body.numberOfReviews ?? 0,
      isFavorite: false,
      deliveryTime: body.deliveryTime ?? '30-45 min',
      deliveryFee: typeof body.deliveryFee === 'number' ? body.deliveryFee : parseFloat(body.deliveryFee) || 0,
      minimumOrder: typeof body.minimumOrder === 'number' ? body.minimumOrder : parseFloat(body.minimumOrder) || 0,
      isOpen: body.isOpen !== false,
      openingHours,
      address: body.address ?? body.addressEn ?? '',
      addressAr: body.addressAr ?? body.address ?? '',
      addressEn: body.addressEn ?? body.address ?? '',
      phone: body.phone ?? '',
      category: body.category ?? 'restaurants',
      categoryAr: body.categoryAr ?? body.category ?? '',
      categoryEn: body.categoryEn ?? body.category ?? '',
      subCategories: Array.isArray(body.subCategories) ? body.subCategories : [],
      isPremium: body.isPremium === true,
      mapsUrl: body.mapsUrl ?? '',
      closingTime: body.closingTime ?? null,
      arhebFee: req.admin.role === ROLES.SUPERADMIN && body.arhebFee != null ? (typeof body.arhebFee === 'number' ? body.arhebFee : parseFloat(body.arhebFee)) : null,
      storeCategories: Array.isArray(body.storeCategories) ? body.storeCategories : [],
      paused: false,
      blocked: false,
    };
    stores.push(newStore);
    saveStores(stores);
    try {
      const insertStoreListing = db.prepare(`
        INSERT INTO store_listings (id, name, nameAr, nameEn, cover, logo, rate, numberOfReviews, isFavorite, deliveryTime, deliveryFee, minimumOrder, isOpen, openingHoursOpen, openingHoursClose, address, addressAr, addressEn, phone, category, categoryAr, categoryEn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStoreListing.run(
        newStore.id,
        newStore.name ?? null,
        newStore.nameAr ?? null,
        newStore.nameEn ?? null,
        newStore.cover ?? null,
        newStore.logo ?? null,
        newStore.rate ?? null,
        newStore.numberOfReviews ?? null,
        0,
        newStore.deliveryTime ?? null,
        newStore.deliveryFee ?? null,
        newStore.minimumOrder ?? null,
        newStore.isOpen ? 1 : 0,
        newStore.openingHours?.open ?? null,
        newStore.openingHours?.close ?? null,
        newStore.address ?? null,
        newStore.addressAr ?? null,
        newStore.addressEn ?? null,
        newStore.phone ?? null,
        newStore.category ?? null,
        newStore.categoryAr ?? null,
        newStore.categoryEn ?? null
      );
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    return res.status(201).json({ success: true, data: { store: newStore } });
  });

  app.get('/api/admin/stores/:id', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const stores = loadStores();
    const store = stores.find((s) => s.id === req.params.id);
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    const out = req.admin.role === ROLES.SUPERADMIN ? store : (() => { const { arhebFee, ...rest } = store; return rest; })();
    out.storeCategories = Array.isArray(out.storeCategories) ? out.storeCategories : [];
    return res.status(200).json({ success: true, data: { store: out } });
  });

  app.patch('/api/admin/stores/:id', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const stores = loadStores();
    const idx = stores.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Store not found' });
    const store = stores[idx];
    if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can make changes.' });
    }
    const allowed = ['name', 'nameAr', 'nameEn', 'cover', 'logo', 'deliveryTime', 'deliveryFee', 'minimumOrder', 'isOpen', 'openingHours', 'address', 'addressAr', 'addressEn', 'phone', 'category', 'categoryAr', 'categoryEn', 'subCategories', 'mapsUrl', 'closingTime'];
    const body = req.body || {};
    if (body.subCategories !== undefined) {
      stores[idx].subCategories = Array.isArray(body.subCategories) ? body.subCategories : [];
    }
    if (body.storeCategories !== undefined) {
      stores[idx].storeCategories = Array.isArray(body.storeCategories) ? body.storeCategories : [];
    }
    if (body.isPremium !== undefined) {
      if (req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin or Admin can set premium' });
      }
      stores[idx].isPremium = Boolean(body.isPremium);
    }
    if (body.arhebFee !== undefined) {
      if (req.admin.role !== ROLES.SUPERADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin can set arhebFee' });
      }
      stores[idx].arhebFee = body.arhebFee === null || body.arhebFee === '' ? null : (typeof body.arhebFee === 'number' ? body.arhebFee : parseFloat(body.arhebFee));
    }
    if (body.paused !== undefined) {
      if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Store is blocked' });
      }
      stores[idx].paused = Boolean(body.paused);
    }
    if (body.blocked !== undefined) {
      if (req.admin.role !== ROLES.SUPERADMIN && req.admin.role !== ROLES.ADMIN) {
        return res.status(403).json({ success: false, message: 'Only Admin or SuperAdmin can block or unblock a store' });
      }
      stores[idx].blocked = Boolean(body.blocked);
    }
    for (const key of allowed) {
      if (body[key] !== undefined) stores[idx][key] = body[key];
    }
    saveStores(stores);
    return res.status(200).json({ success: true, data: { store: stores[idx] } });
  });

  // Clone store: SuperAdmin/Admin can clone any store; Store Admin can clone only their store
  app.post('/api/admin/stores/:id/clone', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const sourceId = req.params.id;
    const body = req.body || {};
    const stores = loadStores();
    const sourceStore = stores.find((s) => String(s.id) === String(sourceId));
    if (!sourceStore) return res.status(404).json({ success: false, message: 'Store not found' });

    const ids = stores.map((s) => parseInt(String(s.id), 10)).filter((n) => !isNaN(n));
    const nextId = ids.length ? String(Math.max(...ids) + 1) : '1';

    const newStore = {
      id: nextId,
      name: sourceStore.name ?? '',
      nameAr: sourceStore.nameAr ?? sourceStore.name ?? '',
      nameEn: sourceStore.nameEn ?? sourceStore.name ?? '',
      cover: sourceStore.cover ?? '',
      logo: sourceStore.logo ?? '',
      rate: sourceStore.rate ?? 4,
      numberOfReviews: 0,
      isFavorite: false,
      deliveryTime: sourceStore.deliveryTime ?? '30-45 min',
      deliveryFee: sourceStore.deliveryFee ?? 0,
      minimumOrder: sourceStore.minimumOrder ?? 0,
      isOpen: sourceStore.isOpen !== false,
      openingHours: sourceStore.openingHours ? { ...sourceStore.openingHours } : { open: '09:00', close: '23:00' },
      address: body.address ?? body.addressEn ?? sourceStore.address ?? '',
      addressAr: body.addressAr ?? body.address ?? sourceStore.addressAr ?? '',
      addressEn: body.addressEn ?? body.address ?? sourceStore.addressEn ?? '',
      phone: sourceStore.phone ?? '',
      category: sourceStore.category ?? 'restaurants',
      categoryAr: sourceStore.categoryAr ?? sourceStore.category ?? '',
      categoryEn: sourceStore.categoryEn ?? sourceStore.category ?? '',
      subCategories: Array.isArray(sourceStore.subCategories) ? [...sourceStore.subCategories] : [],
      isPremium: sourceStore.isPremium === true,
      mapsUrl: body.mapsUrl ?? sourceStore.mapsUrl ?? '',
      closingTime: body.closingTime ?? sourceStore.closingTime ?? null,
      arhebFee: sourceStore.arhebFee != null ? sourceStore.arhebFee : null,
      storeCategories: Array.isArray(sourceStore.storeCategories) ? [...sourceStore.storeCategories] : [],
      paused: false,
      blocked: false,
    };
    stores.push(newStore);
    saveStores(stores);

    try {
      const insertStoreListing = db.prepare(`
        INSERT INTO store_listings (id, name, nameAr, nameEn, cover, logo, rate, numberOfReviews, isFavorite, deliveryTime, deliveryFee, minimumOrder, isOpen, openingHoursOpen, openingHoursClose, address, addressAr, addressEn, phone, category, categoryAr, categoryEn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStoreListing.run(
        newStore.id,
        newStore.name ?? null,
        newStore.nameAr ?? null,
        newStore.nameEn ?? null,
        newStore.cover ?? null,
        newStore.logo ?? null,
        newStore.rate ?? null,
        0,
        0,
        newStore.deliveryTime ?? null,
        newStore.deliveryFee ?? null,
        newStore.minimumOrder ?? null,
        newStore.isOpen ? 1 : 0,
        newStore.openingHours?.open ?? null,
        newStore.openingHours?.close ?? null,
        newStore.address ?? null,
        newStore.addressAr ?? null,
        newStore.addressEn ?? null,
        newStore.phone ?? null,
        newStore.category ?? null,
        newStore.categoryAr ?? null,
        newStore.categoryEn ?? null
      );
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }

    const products = loadProducts();
    const sourceProducts = products.filter((p) => String(p.store?.id) === String(sourceId));
    const maxProductId = products.length ? Math.max(...products.map((p) => parseInt(p.id, 10) || 0)) : 0;
    let nextProductId = maxProductId + 1;
    const newProducts = sourceProducts.map((p) => {
      const cloned = JSON.parse(JSON.stringify(p));
      cloned.id = String(nextProductId++);
      cloned.store = {
        id: newStore.id,
        name: newStore.name,
        nameAr: newStore.nameAr,
        nameEn: newStore.nameEn,
        cover: newStore.cover,
        logo: newStore.logo,
        rate: newStore.rate,
        numberOfReviews: newStore.numberOfReviews,
        isFavorite: newStore.isFavorite,
      };
      return cloned;
    });
    products.push(...newProducts);
    saveProducts(products);

    return res.status(201).json({
      success: true,
      message: 'Store cloned successfully',
      data: { store: newStore, productsCloned: newProducts.length },
    });
  });

  app.delete('/api/admin/stores/:id', auth, requireAdminOrSuper, (req, res) => {
    const storeId = req.params.id;
    const stores = loadStores();
    const idx = stores.findIndex((s) => String(s.id) === String(storeId));
    if (idx === -1) return res.status(404).json({ success: false, message: 'Store not found' });
    stores.splice(idx, 1);
    saveStores(stores);
    const products = loadProducts();
    const remaining = products.filter((p) => String(p.store?.id) !== String(storeId));
    if (remaining.length !== products.length) {
      saveProducts(remaining);
    }
    return res.status(200).json({ success: true, message: 'Store deleted' });
  });

  // ——— Pending products (approval queue) ———
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storeId TEXT NOT NULL,
      submittedBy INTEGER NOT NULL,
      productData TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewedBy INTEGER,
      reviewNote TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewedAt TEXT
    )
  `);

  function buildProductObject(body, store) {
    const products = loadProducts();
    const id = String(products.length ? Math.max(...products.map((p) => parseInt(p.id, 10) || 0)) + 1 : 1);
    return {
      id,
      name: body.name ?? '',
      nameAr: body.nameAr ?? body.name ?? '',
      nameEn: body.nameEn ?? body.name ?? '',
      image: body.image ?? '',
      images: Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []),
      price: typeof body.price === 'number' ? body.price : parseFloat(body.price) || 0,
      originalPrice: typeof body.originalPrice === 'number' ? body.originalPrice : (parseFloat(body.originalPrice) || (body.price != null ? body.price : 0)),
      discount: body.discount ?? null,
      unit: body.unit ?? 'piece',
      unitAr: body.unitAr ?? body.unit ?? 'piece',
      unitEn: body.unitEn ?? body.unit ?? 'piece',
      category: body.category ?? '',
      categoryAr: body.categoryAr ?? body.category ?? '',
      categoryEn: body.categoryEn ?? body.category ?? '',
      subCategory: body.subCategory ?? '',
      subCategoryAr: body.subCategoryAr ?? body.subCategory ?? '',
      subCategoryEn: body.subCategoryEn ?? body.subCategory ?? '',
      description: body.description ?? '',
      descriptionAr: body.descriptionAr ?? body.description ?? '',
      descriptionEn: body.descriptionEn ?? body.description ?? '',
      stock: typeof body.stock === 'number' ? body.stock : parseInt(body.stock, 10) || 0,
      isAvailable: body.isAvailable !== false,
      store: {
        id: store.id,
        name: store.name,
        nameAr: store.nameAr,
        nameEn: store.nameEn,
        cover: store.cover,
        logo: store.logo,
        rate: store.rate,
        numberOfReviews: store.numberOfReviews,
        isFavorite: store.isFavorite,
      },
    };
  }

  // ——— Products (per store) ———
  app.get('/api/admin/stores/:storeId/products', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const products = loadProducts();
    const storeProducts = products.filter((p) => p.store?.id === req.params.storeId);
    return res.status(200).json({ success: true, data: { products: storeProducts } });
  });

  app.post('/api/admin/stores/:storeId/products', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const storeId = req.params.storeId;
    const stores = loadStores();
    const store = stores.find((s) => s.id === storeId);
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can add products.' });
    }
    const body = req.body || {};

    if (req.admin.role === ROLES.STORE_ADMIN) {
      const productData = buildProductObject(body, store);
      db.prepare(
        'INSERT INTO pending_products (storeId, submittedBy, productData, status) VALUES (?, ?, ?, ?)'
      ).run(storeId, req.admin.adminId, JSON.stringify(productData), 'pending');
      const pending = db.prepare('SELECT * FROM pending_products WHERE id = last_insert_rowid()').get();
      return res.status(201).json({
        success: true,
        message: 'Product submitted for approval. An admin will review it.',
        data: {
          pendingId: pending.id,
          status: 'pending',
          product: productData,
        },
      });
    }

    const products = loadProducts();
    const newProduct = buildProductObject(body, store);
    products.push(newProduct);
    saveProducts(products);
    return res.status(201).json({ success: true, data: { product: newProduct } });
  });

  const EXCEL_HEADERS = ['nameEn', 'nameAr', 'name', 'price', 'originalPrice', 'discount', 'unit', 'category', 'categoryAr', 'categoryEn', 'description', 'stock', 'isAvailable'];

  app.post('/api/admin/stores/:storeId/products/import', auth, requireStoreAccess((req) => req.params.storeId), upload.single('file'), (req, res) => {
    const storeId = req.params.storeId;
    const stores = loadStores();
    const store = stores.find((s) => s.id === storeId);
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    if (store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can import products.' });
    }
    if (!req.file || !req.file.buffer) return res.status(400).json({ success: false, message: 'No file uploaded. Use field name "file".' });
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid Excel file' });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return res.status(400).json({ success: false, message: 'Empty workbook' });
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) return res.status(400).json({ success: false, message: 'Excel must have header row and at least one data row' });
    const headerRow = rows[0].map((h) => (h != null ? String(h).trim() : ''));
    const colIndex = (key) => headerRow.findIndex((h) => h.toLowerCase() === key.toLowerCase() || h === key);
    const products = loadProducts();
    const isStoreAdmin = req.admin.role === ROLES.STORE_ADMIN;
    let created = 0;
    let errors = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const get = (key) => {
        const idx = colIndex(key);
        if (idx < 0) return '';
        const v = row[idx];
        return v != null ? String(v).trim() : '';
      };
      const nameEn = get('nameEn') || get('name');
      if (!nameEn) continue;
      const body = {
        nameEn,
        nameAr: get('nameAr') || nameEn,
        name: get('name') || nameEn,
        price: parseFloat(get('price')) || 0,
        originalPrice: get('originalPrice') ? parseFloat(get('originalPrice')) : undefined,
        discount: get('discount') || null,
        unit: get('unit') || 'piece',
        category: get('category'),
        categoryAr: get('categoryAr') || get('category'),
        categoryEn: get('categoryEn') || get('category'),
        description: get('description'),
        stock: parseInt(get('stock'), 10) || 0,
        isAvailable: (get('isAvailable') || 'Y').toUpperCase() !== 'N',
      };
      try {
        const newProduct = buildProductObject(body, store);
        if (isStoreAdmin) {
          db.prepare('INSERT INTO pending_products (storeId, submittedBy, productData, status) VALUES (?, ?, ?, ?)').run(storeId, req.admin.adminId, JSON.stringify(newProduct), 'pending');
        } else {
          products.push(newProduct);
          saveProducts(products);
        }
        created++;
      } catch (e) {
        errors.push(`Row ${i + 1}: ${e.message || 'Failed'}`);
      }
    }
    return res.status(200).json({
      success: true,
      message: isStoreAdmin ? `${created} product(s) submitted for approval` : `${created} product(s) imported`,
      data: { created, errors: errors.length ? errors : undefined },
    });
  });

  app.get('/api/admin/stores/:storeId/products/export', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const storeId = req.params.storeId;
    const products = loadProducts();
    const storeProducts = products.filter((p) => p.store?.id === storeId);
    const rows = [EXCEL_HEADERS];
    storeProducts.forEach((p) => {
      rows.push([
        p.nameEn ?? '',
        p.nameAr ?? '',
        p.name ?? '',
        p.price ?? 0,
        p.originalPrice ?? '',
        p.discount ?? '',
        p.unit ?? 'piece',
        p.category ?? '',
        p.categoryAr ?? '',
        p.categoryEn ?? '',
        p.description ?? '',
        p.stock ?? 0,
        p.isAvailable !== false ? 'Y' : 'N',
      ]);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="store-${storeId}-products.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  });

  // List pending products
  app.get('/api/admin/pending-products', auth, (req, res) => {
    let rows;
    if (req.admin.role === ROLES.STORE_ADMIN) {
      rows = db.prepare('SELECT * FROM pending_products WHERE storeId = ? ORDER BY id DESC').all(req.admin.storeId);
    } else {
      rows = db.prepare('SELECT * FROM pending_products ORDER BY id DESC').all();
    }
    const list = rows.map((r) => {
      let product = {};
      try { product = JSON.parse(r.productData); } catch (_) {}
      return {
        id: r.id,
        storeId: r.storeId,
        submittedBy: r.submittedBy,
        status: r.status,
        reviewedBy: r.reviewedBy,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        product,
      };
    });
    return res.status(200).json({ success: true, data: { pendingProducts: list } });
  });

  // View pending product detail
  app.get('/api/admin/pending-products/:id', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const row = db.prepare('SELECT * FROM pending_products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Pending product not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && row.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    let product = {};
    try { product = JSON.parse(row.productData); } catch (_) {}
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        storeId: row.storeId,
        submittedBy: row.submittedBy,
        status: row.status,
        reviewedBy: row.reviewedBy,
        reviewNote: row.reviewNote,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        product,
      },
    });
  });

  // Approve pending product (SuperAdmin / Admin only)
  app.post('/api/admin/pending-products/:id/approve', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const row = db.prepare('SELECT * FROM pending_products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Pending product not found' });
    if (row.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Product already ${row.status}` });
    }
    let productData = {};
    try { productData = JSON.parse(row.productData); } catch (_) {}

    const products = loadProducts();
    const newId = String(products.length ? Math.max(...products.map((p) => parseInt(p.id, 10) || 0)) + 1 : 1);
    productData.id = newId;
    products.push(productData);
    saveProducts(products);

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE pending_products SET status = ?, reviewedBy = ?, reviewedAt = ?, productData = ? WHERE id = ?'
    ).run('approved', req.admin.adminId, now, JSON.stringify(productData), id);
    return res.status(200).json({
      success: true,
      message: 'Product approved and added to store',
      data: { product: productData },
    });
  });

  // Reject pending product (SuperAdmin / Admin only)
  app.post('/api/admin/pending-products/:id/reject', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const row = db.prepare('SELECT * FROM pending_products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Pending product not found' });
    if (row.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Product already ${row.status}` });
    }
    const { note } = req.body || {};
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE pending_products SET status = ?, reviewedBy = ?, reviewNote = ?, reviewedAt = ? WHERE id = ?'
    ).run('rejected', req.admin.adminId, note || null, now, id);
    let product = {};
    try { product = JSON.parse(row.productData); } catch (_) {}
    return res.status(200).json({
      success: true,
      message: 'Product rejected',
      data: { id: row.id, status: 'rejected', note: note || null, product },
    });
  });

  app.patch('/api/admin/stores/:storeId/products/:productId', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId, productId } = req.params;
    const stores = loadStores();
    const store = stores.find((s) => s.id === storeId);
    if (store && store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can edit products.' });
    }
    const products = loadProducts();
    const idx = products.findIndex((p) => p.id === productId && p.store?.id === storeId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Product not found' });
    const allowed = [
      'name', 'nameAr', 'nameEn', 'image', 'images', 'price', 'originalPrice', 'discount',
      'unit', 'unitAr', 'unitEn', 'category', 'categoryAr', 'categoryEn',
      'subCategory', 'subCategoryAr', 'subCategoryEn',
      'description', 'descriptionAr', 'descriptionEn', 'stock', 'isAvailable',
      'ingredients', 'ingredientsAr', 'ingredientsEn', 'allergens', 'allergensAr', 'allergensEn',
      'nutritionalInfo', 'preparationTime',
    ];
    const body = req.body || {};
    for (const key of allowed) {
      if (body[key] !== undefined) products[idx][key] = body[key];
    }
    saveProducts(products);
    return res.status(200).json({ success: true, data: { product: products[idx] } });
  });

  app.delete('/api/admin/stores/:storeId/products/:productId', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId, productId } = req.params;
    const stores = loadStores();
    const store = stores.find((s) => s.id === storeId);
    if (store && store.blocked === true && req.admin.role === ROLES.STORE_ADMIN) {
      return res.status(403).json({ success: false, message: 'Store is blocked. Only Admin or SuperAdmin can delete products.' });
    }
    const products = loadProducts();
    const idx = products.findIndex((p) => p.id === productId && p.store?.id === storeId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Product not found' });
    products.splice(idx, 1);
    saveProducts(products);
    return res.status(200).json({ success: true, message: 'Product deleted' });
  });

  // ——— Driver requests (orderId, driverId, status: pending|accepted|rejected) ———
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS driver_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId INTEGER NOT NULL,
        driverId INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(orderId, driverId)
      )
    `);
  } catch (e) {
    // table exists
  }

  // ——— Orders: same DB/table as checkout and order tracking; Store Admin sees their store or unassigned (null storeId) ———
  app.get('/api/admin/orders/counts', auth, (req, res) => {
    const conditions = [];
    const params = [];
    if (req.admin.role === ROLES.STORE_ADMIN) {
      conditions.push('(storeId = ? OR storeId IS NULL)');
      params.push(req.admin.storeId);
    }
    const wherePrefix = conditions.length ? ' WHERE ' + conditions.join(' AND ') + ' AND ' : ' WHERE ';
    const activeSql = 'SELECT COUNT(*) AS n FROM orders' + wherePrefix + "(status IS NULL OR status NOT IN ('Delivered', 'Cancelled'))";
    const deliveredSql = "SELECT COUNT(*) AS n FROM orders" + wherePrefix + "status = 'Delivered'";
    const cancelledSql = "SELECT COUNT(*) AS n FROM orders" + wherePrefix + "status = 'Cancelled'";
    const active = db.prepare(activeSql).get(...params)?.n ?? 0;
    const delivered = db.prepare(deliveredSql).get(...params)?.n ?? 0;
    const cancelled = db.prepare(cancelledSql).get(...params)?.n ?? 0;
    return res.status(200).json({ success: true, data: { active, delivered, cancelled, complete: delivered + cancelled } });
  });

  // ——— Orders (sorted newest first; filter by date range, status, store, name, orderType) ———
  app.get('/api/admin/orders', auth, (req, res) => {
    const { dateFrom, dateTo, status, storeId, storeName, name, orderType } = req.query;
    const conditions = [];
    const params = [];

    if (req.admin.role === ROLES.STORE_ADMIN) {
      conditions.push('(storeId = ? OR storeId IS NULL)');
      params.push(req.admin.storeId);
    }
    if (dateFrom) {
      conditions.push("date(createdAt) >= date(?)");
      params.push(String(dateFrom).trim());
    }
    if (dateTo) {
      conditions.push("date(createdAt) <= date(?)");
      params.push(String(dateTo).trim());
    }
    if (orderType === 'active') {
      conditions.push("(status IS NULL OR status NOT IN ('Delivered', 'Cancelled'))");
    } else if (orderType === 'complete') {
      conditions.push("status IN ('Delivered', 'Cancelled')");
    } else if (orderType === 'delivered') {
      conditions.push("status = 'Delivered'");
    } else if (orderType === 'cancelled') {
      conditions.push("status = 'Cancelled'");
    }
    if (status && String(status).trim()) {
      conditions.push('status = ?');
      params.push(String(status).trim());
    }
    if (storeId && String(storeId).trim()) {
      conditions.push('storeId = ?');
      params.push(String(storeId).trim());
    }
    if (name && String(name).trim()) {
      const term = '%' + String(name).trim() + '%';
      conditions.push('(name LIKE ? OR phoneNumber LIKE ?)');
      params.push(term, term);
    }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const sql = 'SELECT * FROM orders' + where + ' ORDER BY createdAt DESC, id DESC';
    let orders = db.prepare(sql).all(...params);

    if (storeName && String(storeName).trim()) {
      const stores = loadStores();
      const storeNameLower = String(storeName).trim().toLowerCase();
      const matchingStoreIds = new Set(
        stores
          .filter((s) => (s.nameEn || s.name || '').toLowerCase().includes(storeNameLower) || (s.nameAr || '').toLowerCase().includes(storeNameLower))
          .map((s) => s.id)
      );
      orders = orders.filter((o) => matchingStoreIds.has(o.storeId));
    }

    const storesList = loadStores();
    const storeById = Object.fromEntries(storesList.map((s) => [s.id, s]));

    const withItems = orders.map((order) => {
      const items = findOrderItems.all(order.id);
      const store = order.storeId ? storeById[order.storeId] : null;
      return {
        ...order,
        storeName: store ? (store.nameEn || store.name || store.nameAr) : (order.storeId || '-'),
        items: items.map((i) => ({ id: i.productId, name: i.productName, price: i.price, quantity: i.quantity })),
      };
    });

    return res.status(200).json({ success: true, data: { orders: withItems } });
  });

  // ——— Get single order (full details for admin) ———
  app.get('/api/admin/orders/:orderId', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const items = findOrderItems.all(orderId);
    const storesList = loadStores();
    const store = order.storeId ? storesList.find((s) => s.id === order.storeId) : null;
    const storeName = store ? (store.nameEn || store.name || store.nameAr) : (order.storeId || '-');
    return res.status(200).json({
      success: true,
      data: {
        order: {
          ...order,
          storeName,
          items: items.map((i) => ({ id: i.productId, name: i.productName, price: i.price, quantity: i.quantity })),
        },
      },
    });
  });

  app.patch('/api/admin/orders/:orderId/status', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const { status } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status.trim(), orderId);
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
    // Notify customer of order status change via FCM
    fcm.sendToUserByPhone(db, order.phoneNumber, 'Order status updated', `Order #${orderId} is now: ${status.trim()}`, null, { orderId: String(orderId), status: status.trim(), type: 'order_status' }).catch(() => {});
    return res.status(200).json({
      success: true,
      data: {
        order: {
          ...updated,
          items: items.map((i) => ({ id: i.productId, name: i.productName, price: i.price, quantity: i.quantity })),
        },
      },
    });
  });

  // ——— Get available drivers for assigning to an order (Store Admin / Admin / SuperAdmin) ———
  app.get('/api/admin/orders/:orderId/available-drivers', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    let drivers = [];
    try {
      drivers = db.prepare('SELECT id, name, mobile, vehicleType, vehicleNumber FROM drivers WHERE isBlocked = 0 ORDER BY name').all();
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const pendingDriverIds = new Set();
    try {
      const pending = db.prepare('SELECT driverId FROM driver_requests WHERE orderId = ? AND status = ?').all(orderId, 'pending');
      pending.forEach((r) => pendingDriverIds.add(r.driverId));
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const list = drivers
      .filter((d) => !pendingDriverIds.has(d.id))
      .map((d) => ({ id: d.id, name: d.name, mobile: d.mobile, vehicleType: d.vehicleType || null, vehicleNumber: d.vehicleNumber || null }));
    return res.status(200).json({ success: true, data: { drivers: list } });
  });

  // ——— Get nearby active drivers for an order (presence + distance to store; Store Admin / Admin / SuperAdmin) ———
  app.get('/api/admin/orders/:orderId/nearby-drivers', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    let drivers = [];
    try {
      drivers = db.prepare('SELECT id, name, mobile, vehicleType, vehicleNumber FROM drivers WHERE isBlocked = 0 ORDER BY name').all();
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const pendingDriverIds = new Set();
    try {
      const pending = db.prepare('SELECT driverId FROM driver_requests WHERE orderId = ? AND status = ?').all(orderId, 'pending');
      pending.forEach((r) => pendingDriverIds.add(r.driverId));
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const candidateIds = drivers.filter((d) => !pendingDriverIds.has(d.id)).map((d) => d.id);
    const stores = loadStores();
    const store = order.storeId ? stores.find((s) => String(s.id) === String(order.storeId)) : null;
    const storeLat = store && (store.latitude != null || store.lat != null) ? (store.latitude ?? store.lat) : null;
    const storeLong = store && (store.longitude != null || store.long != null) ? (store.longitude ?? store.long) : null;
    const withDistance = getActiveFromListWithDistance(candidateIds, storeLat, storeLong);
    const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
    const list = withDistance.map((d) => ({
      ...driverById[d.driverId],
      id: d.driverId,
      latitude: d.latitude,
      longitude: d.longitude,
      lastSeen: d.lastSeen,
      distanceKm: d.distanceKm,
    }));
    return res.status(200).json({ success: true, data: { drivers: list } });
  });

  // ——— Request driver(s) to pick up order (when status is Preparing) ———
  app.post('/api/admin/orders/:orderId/request-driver', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const statusLower = (order.status || '').toLowerCase();
    if (!statusLower.includes('preparing') && !statusLower.includes('waiting')) {
      return res.status(400).json({ success: false, message: 'Can only request driver when order is Preparing or Waiting confirmation' });
    }
    if (order.driverId != null) {
      return res.status(400).json({ success: false, message: 'Order already has a driver assigned' });
    }
    const { driverIds } = req.body || {};
    const ids = Array.isArray(driverIds) ? driverIds.map((id) => parseInt(id, 10)).filter((n) => !isNaN(n)) : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: 'driverIds array is required' });
    const insertRequest = db.prepare('INSERT OR IGNORE INTO driver_requests (orderId, driverId, status) VALUES (?, ?, ?)');
    const insertedIds = [];
    for (const driverId of ids) {
      const driver = db.prepare('SELECT id FROM drivers WHERE id = ? AND isBlocked = 0').get(driverId);
      if (driver) {
        insertRequest.run(orderId, driverId, 'pending');
        insertedIds.push(driverId);
      }
    }
    fcm.sendToDrivers(db, insertedIds, 'New delivery request', `Order #${orderId} has been assigned to you. Open the app to accept.`, { orderId: String(orderId), type: 'driver_request' }).catch(() => {});
    return res.status(200).json({
      success: true,
      message: 'Request sent to driver(s). They can accept in the driver app.',
      data: { orderId },
    });
  });

  // ——— Auto-assign order to nearest active driver ———
  app.post('/api/admin/orders/:orderId/auto-assign', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const statusLower = (order.status || '').toLowerCase();
    if (!statusLower.includes('preparing') && !statusLower.includes('waiting')) {
      return res.status(400).json({ success: false, message: 'Can only auto-assign when order is Preparing or Waiting confirmation' });
    }
    if (order.driverId != null) {
      return res.status(400).json({ success: false, message: 'Order already has a driver assigned' });
    }
    let drivers = [];
    try {
      drivers = db.prepare('SELECT id FROM drivers WHERE isBlocked = 0').all();
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const pendingDriverIds = new Set();
    try {
      const pending = db.prepare('SELECT driverId FROM driver_requests WHERE orderId = ? AND status = ?').all(orderId, 'pending');
      pending.forEach((r) => pendingDriverIds.add(r.driverId));
    } catch (e) {
      if (!e.message || !e.message.includes('no such table')) throw e;
    }
    const candidateIds = drivers.filter((d) => !pendingDriverIds.has(d.id)).map((d) => d.id);
    const stores = loadStores();
    const store = order.storeId ? stores.find((s) => String(s.id) === String(order.storeId)) : null;
    const storeLat = store && (store.latitude != null || store.lat != null) ? (store.latitude ?? store.lat) : null;
    const storeLong = store && (store.longitude != null || store.long != null) ? (store.longitude ?? store.long) : null;
    const withDistance = getActiveFromListWithDistance(candidateIds, storeLat, storeLong);
    const nearest = withDistance[0];
    if (!nearest) {
      return res.status(404).json({
        success: false,
        message: 'No active drivers nearby. Ask drivers to go online (connect to the app).',
        data: { orderId },
      });
    }
    const insertRequest = db.prepare('INSERT OR IGNORE INTO driver_requests (orderId, driverId, status) VALUES (?, ?, ?)');
    insertRequest.run(orderId, nearest.driverId, 'pending');
    fcm.sendToDriver(db, nearest.driverId, 'New delivery assigned', `Order #${orderId} has been auto-assigned to you. Open the app to accept.`, { orderId: String(orderId), type: 'driver_request' }).catch(() => {});
    return res.status(200).json({
      success: true,
      message: 'Order auto-assigned to nearest active driver. They will be notified.',
      data: { orderId, driverId: nearest.driverId },
    });
  });

  // ——— Get order tracking state (for dashboard live map; Store Admin / Admin / SuperAdmin) ———
  app.get('/api/admin/orders/:orderId/tracking', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId != null && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    let getOrderTrackingState;
    try {
      getOrderTrackingState = require('../order').getOrderTrackingState;
    } catch (e) {
      getOrderTrackingState = null;
    }
    const tracking = getOrderTrackingState ? getOrderTrackingState(orderId) : null;
    const lastLocation = tracking?.lastLocation || null;
    return res.status(200).json({
      success: true,
      data: {
        orderId,
        orderStatus: order.status,
        driverId: order.driverId,
        driverName: order.driverName,
        isTracking: !!lastLocation,
        driverConnected: !!(tracking && tracking.driverSocket),
        lastLocation: lastLocation ? {
          latitude: lastLocation.latitude,
          longitude: lastLocation.longitude,
          timestamp: lastLocation.timestamp,
        } : null,
        trackFrom: 'driver_accept_until_delivery',
      },
    });
  });

  // ——— Delete order (Admin and SuperAdmin only; order_items removed by CASCADE) ———
  app.delete('/api/admin/orders/:orderId', auth, requireAdminOrSuper, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    db.prepare('DELETE FROM order_items WHERE orderId = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    return res.status(200).json({ success: true, message: 'Order deleted' });
  });

  // ——— Send broadcast notification to all registered app users (Admin / SuperAdmin) ———
  app.post('/api/admin/notifications/broadcast', auth, requireAdminOrSuper, async (req, res) => {
    const { title, body, imageUrl } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }
    const bodyStr = typeof body === 'string' ? body : (body != null ? String(body) : '');
    const image = typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null;
    try {
      const result = await fcm.sendToAllUsers(db, title.trim(), bodyStr, image, { type: 'broadcast' });
      return res.status(200).json({
        success: true,
        message: 'Broadcast notification sent',
        data: { successCount: result.successCount, failureCount: result.failureCount },
      });
    } catch (e) {
      console.error('Broadcast notification error:', e);
      return res.status(500).json({ success: false, message: 'Failed to send broadcast notification' });
    }
  });

  // ——— Dashboard sales (and for Admin/SuperAdmin: open/closed store counts) ———
  app.get('/api/admin/dashboard/sales', auth, (req, res) => {
    let orders;
    if (req.admin.role === ROLES.STORE_ADMIN) {
      orders = db.prepare('SELECT * FROM orders WHERE storeId = ?').all(req.admin.storeId);
    } else {
      orders = db.prepare('SELECT * FROM orders').all();
    }
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const byStatus = {};
    orders.forEach((o) => {
      const s = o.status || 'Unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    const recent = orders
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map((o) => ({ id: o.id, totalAmount: o.totalAmount, status: o.status, createdAt: o.createdAt, storeId: o.storeId }));
    const data = {
      totalOrders: orders.length,
      totalRevenue,
      byStatus,
      recentOrders: recent,
    };
    // Admin and SuperAdmin only: open/closed store counts (exclude paused/blocked from "all" but count by isOpen)
    if (req.admin.role === ROLES.ADMIN || req.admin.role === ROLES.SUPERADMIN) {
      const stores = loadStores();
      data.openStoresCount = stores.filter((s) => s.isOpen === true).length;
      data.closedStoresCount = stores.filter((s) => s.isOpen !== true).length;
    }
    return res.status(200).json({ success: true, data });
  });

  // ——— Arheb Box requests (admin can list, update status, assign driver) ———
  app.get('/api/admin/arheb-box', auth, (req, res) => {
    try {
      const rows = db.prepare(
        'SELECT id, phoneNumber, userName, pickup, dropoff, notes, status, driverId, driverName, createdAt FROM arheb_box_requests ORDER BY createdAt DESC, id DESC'
      ).all();
      const requests = rows.map((r) => ({
        id: r.id,
        phoneNumber: r.phoneNumber,
        userName: r.userName,
        pickup: (() => { try { return JSON.parse(r.pickup); } catch (e) { return {}; } })(),
        dropoff: (() => { try { return JSON.parse(r.dropoff); } catch (e) { return {}; } })(),
        notes: r.notes,
        status: r.status,
        driverId: r.driverId ?? null,
        driverName: r.driverName ?? null,
        createdAt: r.createdAt,
      }));
      return res.status(200).json({ success: true, data: { requests } });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { requests: [] } });
      }
      console.error('Arheb box list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list arheb box requests' });
    }
  });

  app.patch('/api/admin/arheb-box/:id', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const { status } = req.body || {};
    if (status === undefined || typeof status !== 'string' || !status.trim()) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    try {
      const rowBefore = db.prepare('SELECT id, phoneNumber, fcmToken FROM arheb_box_requests WHERE id = ?').get(id);
      if (!rowBefore) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      const run = db.prepare('UPDATE arheb_box_requests SET status = ? WHERE id = ?').run(status.trim(), id);
      if (run.changes === 0) {
        return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      }
      fcm.sendToToken(rowBefore.fcmToken, 'Arheb Box update', `Your request #${id} is now: ${status.trim()}`, null, { type: 'arheb_box_status', requestId: String(id), status: status.trim() }).catch(() => {});
      if (!rowBefore.fcmToken) {
        fcm.sendToUserByPhone(db, rowBefore.phoneNumber, 'Arheb Box update', `Your request #${id} is now: ${status.trim()}`, null, { type: 'arheb_box_status', requestId: String(id), status: status.trim() }).catch(() => {});
      }
      const row = db.prepare('SELECT id, phoneNumber, userName, pickup, dropoff, notes, status, driverId, driverName, createdAt FROM arheb_box_requests WHERE id = ?').get(id);
      const request = {
        id: row.id,
        phoneNumber: row.phoneNumber,
        userName: row.userName,
        pickup: (() => { try { return JSON.parse(row.pickup); } catch (e) { return {}; } })(),
        dropoff: (() => { try { return JSON.parse(row.dropoff); } catch (e) { return {}; } })(),
        notes: row.notes,
        status: row.status,
        driverId: row.driverId ?? null,
        driverName: row.driverName ?? null,
        createdAt: row.createdAt,
      };
      return res.status(200).json({ success: true, data: { request } });
    } catch (e) {
      console.error('Arheb box update error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update' });
    }
  });

  app.post('/api/admin/arheb-box/:id/assign-driver', auth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const { driverId } = req.body || {};
    const driverIdNum = driverId != null ? parseInt(driverId, 10) : NaN;
    if (!driverIdNum || isNaN(driverIdNum)) return res.status(400).json({ success: false, message: 'driverId is required' });
    try {
      const row = db.prepare('SELECT id FROM arheb_box_requests WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      const driver = db.prepare('SELECT id, name FROM drivers WHERE id = ? AND isBlocked = 0').get(driverIdNum);
      if (!driver) return res.status(404).json({ success: false, message: 'Driver not found or blocked' });
      db.prepare('UPDATE arheb_box_requests SET driverId = ?, driverName = ?, status = ? WHERE id = ?').run(driverIdNum, driver.name, 'assigned', id);
      fcm.sendToDriver(db, driverIdNum, 'New Arheb Box delivery', `Request #${id} has been assigned to you. Open the app to accept.`, { type: 'arheb_box_assigned', requestId: String(id) }).catch(() => {});
      const updated = db.prepare('SELECT id, phoneNumber, userName, pickup, dropoff, notes, status, driverId, driverName, createdAt FROM arheb_box_requests WHERE id = ?').get(id);
      return res.status(200).json({
        success: true,
        message: 'Driver assigned. They will be notified.',
        data: {
          request: {
            id: updated.id,
            phoneNumber: updated.phoneNumber,
            userName: updated.userName,
            pickup: (() => { try { return JSON.parse(updated.pickup); } catch (e) { return {}; } })(),
            dropoff: (() => { try { return JSON.parse(updated.dropoff); } catch (e) { return {}; } })(),
            notes: updated.notes,
            status: updated.status,
            driverId: updated.driverId,
            driverName: updated.driverName,
            createdAt: updated.createdAt,
          },
        },
      });
    } catch (e) {
      console.error('Arheb box assign driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to assign driver' });
    }
  });

  // ——— Drivers (SuperAdmin / Admin only: add, remove, block) ———
  app.get('/api/admin/drivers', auth, requireAdminOrSuper, (req, res) => {
    try {
      const rows = db.prepare(
        'SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, photo, latitude, longitude, rating, isVerified, isBlocked, createdAt FROM drivers ORDER BY id'
      ).all();
      const drivers = rows.map((r) => ({
        id: r.id,
        name: r.name,
        mobile: r.mobile,
        email: r.email,
        vehicleType: r.vehicleType,
        vehicleNumber: r.vehicleNumber,
        licenseNumber: r.licenseNumber,
        photo: r.photo,
        latitude: r.latitude,
        longitude: r.longitude,
        rating: r.rating ?? 5,
        isVerified: Boolean(r.isVerified),
        isBlocked: Boolean(r.isBlocked),
        createdAt: r.createdAt,
      }));
      return res.status(200).json({ success: true, data: { drivers } });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { drivers: [] } });
      }
      console.error('Admin drivers list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list drivers' });
    }
  });

  app.post('/api/admin/drivers', auth, requireAdminOrSuper, (req, res) => {
    const { name, mobile, email, vehicleType, vehicleNumber, licenseNumber } = req.body || {};
    if (!name || !String(name).trim() || !mobile || !String(mobile).trim()) {
      return res.status(400).json({ success: false, message: 'name and mobile are required' });
    }
    const normalizedMobile = String(mobile).trim();
    try {
      const existing = db.prepare('SELECT id FROM drivers WHERE mobile = ?').get(normalizedMobile);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Driver with this mobile already exists' });
      }
      db.prepare(`
        INSERT INTO drivers (name, mobile, email, vehicleType, vehicleNumber, licenseNumber, photo, latitude, longitude, rating, isVerified, isBlocked)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 5, 0, 0)
      `).run(
        String(name).trim(),
        normalizedMobile,
        email ? String(email).trim() : null,
        vehicleType ? String(vehicleType).trim() : null,
        vehicleNumber ? String(vehicleNumber).trim() : null,
        licenseNumber ? String(licenseNumber).trim() : null
      );
      const driver = db.prepare('SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked, createdAt FROM drivers WHERE mobile = ?').get(normalizedMobile);
      return res.status(201).json({
        success: true,
        message: 'Driver added successfully',
        data: {
          driver: {
            id: driver.id,
            name: driver.name,
            mobile: driver.mobile,
            email: driver.email,
            vehicleType: driver.vehicleType,
            vehicleNumber: driver.vehicleNumber,
            licenseNumber: driver.licenseNumber,
            isBlocked: Boolean(driver.isBlocked),
            createdAt: driver.createdAt,
          },
        },
      });
    } catch (e) {
      console.error('Admin add driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to add driver' });
    }
  });

  app.patch('/api/admin/drivers/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid driver id' });
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
    const { name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked } = req.body || {};
    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(String(name).trim()); }
    if (mobile !== undefined) { updates.push('mobile = ?'); values.push(String(mobile).trim()); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email ? String(email).trim() : null); }
    if (vehicleType !== undefined) { updates.push('vehicleType = ?'); values.push(vehicleType ? String(vehicleType).trim() : null); }
    if (vehicleNumber !== undefined) { updates.push('vehicleNumber = ?'); values.push(vehicleNumber ? String(vehicleNumber).trim() : null); }
    if (licenseNumber !== undefined) { updates.push('licenseNumber = ?'); values.push(licenseNumber ? String(licenseNumber).trim() : null); }
    if (isBlocked !== undefined) { updates.push('isBlocked = ?'); values.push(isBlocked ? 1 : 0); }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }
    values.push(id);
    try {
      db.prepare(`UPDATE drivers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      const updated = db.prepare('SELECT id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked, createdAt FROM drivers WHERE id = ?').get(id);
      return res.status(200).json({
        success: true,
        data: {
          driver: {
            id: updated.id,
            name: updated.name,
            mobile: updated.mobile,
            email: updated.email,
            vehicleType: updated.vehicleType,
            vehicleNumber: updated.vehicleNumber,
            licenseNumber: updated.licenseNumber,
            isBlocked: Boolean(updated.isBlocked),
            createdAt: updated.createdAt,
          },
        },
      });
    } catch (e) {
      console.error('Admin update driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update driver' });
    }
  });

  app.delete('/api/admin/drivers/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid driver id' });
    try {
      const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(id);
      if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });
      db.prepare('UPDATE orders SET driverId = NULL, driverName = NULL WHERE driverId = ?').run(id);
      db.prepare('DELETE FROM drivers WHERE id = ?').run(id);
      return res.status(200).json({ success: true, message: 'Driver removed' });
    } catch (e) {
      console.error('Admin delete driver error:', e);
      return res.status(500).json({ success: false, message: 'Failed to remove driver' });
    }
  });

  // ——— Categories (SuperAdmin / Admin only) ———
  app.get('/api/admin/categories', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    return res.status(200).json({ success: true, data: { categories } });
  });

  app.post('/api/admin/categories', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const body = req.body || {};
    const id = String(categories.length ? Math.max(...categories.map((c) => parseInt(c.id, 10) || 0)) + 1 : 1);
    const newCat = {
      id,
      name: body.name ?? (body.nameEn || '').toLowerCase().replace(/\s+/g, '_').trim() ?? '',
      nameAr: body.nameAr ?? body.name ?? '',
      nameEn: body.nameEn ?? body.name ?? '',
      image: body.image ?? null,
      isComingSoon: Boolean(body.isComingSoon),
      order: body.order ?? categories.length + 1,
      subCategories: Array.isArray(body.subCategories) ? body.subCategories : [],
    };
    categories.push(newCat);
    try {
      syncCategoriesToDb(db, categories);
    } catch (err) {
      console.error('Categories DB sync failed:', err);
      categories.pop();
      return res.status(500).json({ success: false, message: 'Database sync failed', error: err.message });
    }
    saveCategories(categories);
    return res.status(201).json({ success: true, data: { category: newCat } });
  });

  app.patch('/api/admin/categories/:id', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const idParam = String(req.params.id);
    const idx = categories.findIndex((c) => String(c.id) === idParam);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Category not found' });
    const allowed = ['name', 'nameAr', 'nameEn', 'image', 'isComingSoon', 'order', 'subCategories'];
    const body = req.body || {};
    for (const key of allowed) {
      if (body[key] !== undefined) categories[idx][key] = body[key];
    }
    // Keep name in sync when only nameEn/nameAr sent (e.g. from dashboard)
    if (body.nameEn !== undefined && body.name === undefined && categories[idx].nameEn) {
      categories[idx].name = (categories[idx].nameEn || '').toLowerCase().replace(/\s+/g, '_').trim() || categories[idx].name;
    }
    try {
      syncCategoriesToDb(db, categories);
    } catch (err) {
      console.error('Categories DB sync failed:', err);
      return res.status(500).json({ success: false, message: 'Database sync failed', error: err.message });
    }
    saveCategories(categories);
    return res.status(200).json({ success: true, data: { category: categories[idx] } });
  });

  app.delete('/api/admin/categories/:id', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const idParam = String(req.params.id);
    const idx = categories.findIndex((c) => String(c.id) === idParam);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Category not found' });
    categories.splice(idx, 1);
    try {
      syncCategoriesToDb(db, categories);
    } catch (err) {
      console.error('Categories DB sync failed:', err);
      return res.status(500).json({ success: false, message: 'Database sync failed', error: err.message });
    }
    saveCategories(categories);
    return res.status(200).json({ success: true, message: 'Category deleted' });
  });

  // ——— Popup (SuperAdmin / Admin only) ———
  app.get('/api/admin/popup', auth, requireAdminOrSuper, (req, res) => {
    const data = loadPopup();
    return res.status(200).json({ success: true, data: { popup: data } });
  });

  app.patch('/api/admin/popup', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const current = loadPopup();
    const updated = {
      image: body.image !== undefined ? body.image : current.image,
      call_of_action_button: body.call_of_action_button !== undefined ? body.call_of_action_button : current.call_of_action_button,
      destination: body.destination !== undefined ? body.destination : current.destination,
      destination_value: body.destination_value !== undefined ? body.destination_value : current.destination_value,
    };
    savePopup(updated);
    return res.status(200).json({ success: true, data: { popup: updated } });
  });

  // ——— Home banners (SuperAdmin / Admin only) ———
  app.get('/api/admin/home/banners', auth, requireAdminOrSuper, (req, res) => {
    const home = loadHome();
    const banners = home?.data?.banners ?? [];
    return res.status(200).json({ success: true, data: { banners } });
  });

  app.patch('/api/admin/home/banners', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const home = loadHome();
    const data = home.data || {};
    const banners = Array.isArray(body.banners) ? body.banners : data.banners || [];
    const next = {
      ...home,
      data: {
        ...data,
        banners,
      },
    };
    saveHome(next);
    return res.status(200).json({ success: true, data: { banners } });
  });

  // ——— App info / Contact (email, phone, cliqNumber) — Admin & SuperAdmin only ———
  app.get('/api/admin/info', auth, requireAdminOrSuper, (req, res) => {
    try {
      const row = db.prepare('SELECT email, phone, cliqNumber FROM contact_us ORDER BY id DESC LIMIT 1').get();
      if (!row) {
        return res.status(200).json({
          success: true,
          data: { info: { email: '', phone: '', cliqNumber: '' } },
        });
      }
      return res.status(200).json({
        success: true,
        data: {
          info: {
            email: row.email ?? '',
            phone: row.phone ?? '',
            cliqNumber: row.cliqNumber != null ? row.cliqNumber : '',
          },
        },
      });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { info: { email: '', phone: '', cliqNumber: '' } } });
      }
      console.error('Admin get info error:', e);
      return res.status(500).json({ success: false, message: 'Failed to load info' });
    }
  });

  app.patch('/api/admin/info', auth, requireAdminOrSuper, (req, res) => {
    const body = req.body || {};
    const email = body.email !== undefined ? String(body.email).trim() : undefined;
    const phone = body.phone !== undefined ? String(body.phone).trim() : undefined;
    const cliqNumber = body.cliqNumber !== undefined ? String(body.cliqNumber).trim() : undefined;
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    try {
      const row = db.prepare('SELECT id, email, phone, cliqNumber FROM contact_us ORDER BY id DESC LIMIT 1').get();
      if (!row) {
        db.prepare('INSERT INTO contact_us (email, phone, cliqNumber) VALUES (?, ?, ?)').run(
          email ?? 'contact@arheb.com',
          phone ?? '+201234567890',
          cliqNumber ?? ''
        );
      } else {
        db.prepare(`
          UPDATE contact_us SET
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            cliqNumber = COALESCE(?, cliqNumber),
            updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(email ?? null, phone ?? null, cliqNumber ?? null, row.id);
      }
      const updated = db.prepare('SELECT email, phone, cliqNumber FROM contact_us ORDER BY id DESC LIMIT 1').get();
      return res.status(200).json({
        success: true,
        data: {
          info: {
            email: updated.email ?? '',
            phone: updated.phone ?? '',
            cliqNumber: updated.cliqNumber != null ? updated.cliqNumber : '',
          },
        },
      });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(500).json({ success: false, message: 'Contact table not initialized' });
      }
      console.error('Admin patch info error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update info' });
    }
  });

  // ——— Promo codes (SuperAdmin / Admin only) ———
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      value REAL NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const findAllPromoCodes = db.prepare('SELECT * FROM promo_codes ORDER BY id');
  const findPromoCodeById = db.prepare('SELECT * FROM promo_codes WHERE id = ?');
  const findPromoCodeByName = db.prepare('SELECT * FROM promo_codes WHERE name = ?');

  app.get('/api/admin/promo-codes', auth, requireAdminOrSuper, (req, res) => {
    try {
      const rows = findAllPromoCodes.all();
      return res.status(200).json({ success: true, data: { promoCodes: rows } });
    } catch (e) {
      if (e.message && e.message.includes('no such table')) {
        return res.status(200).json({ success: true, data: { promoCodes: [] } });
      }
      console.error('Promo codes list error:', e);
      return res.status(500).json({ success: false, message: 'Failed to list promo codes' });
    }
  });

  app.post('/api/admin/promo-codes', auth, requireAdminOrSuper, (req, res) => {
    const { name, value } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const numValue = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      return res.status(400).json({ success: false, message: 'value must be a non-negative number' });
    }
    try {
      db.prepare('INSERT INTO promo_codes (name, value) VALUES (?, ?)').run(name.trim(), numValue);
      const created = findPromoCodeByName.get(name.trim());
      return res.status(201).json({
        success: true,
        data: {
          id: created.id,
          name: created.name,
          value: created.value,
          createdAt: created.createdAt,
        },
      });
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(400).json({ success: false, message: 'Promo code name already exists' });
      }
      throw e;
    }
  });

  app.patch('/api/admin/promo-codes/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const target = findPromoCodeById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Promo code not found' });
    const { name, value } = req.body || {};
    const updates = [];
    const values = [];
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'name must be a non-empty string' });
      }
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (value !== undefined) {
      const numValue = typeof value === 'number' ? value : parseFloat(value);
      if (isNaN(numValue) || numValue < 0) {
        return res.status(400).json({ success: false, message: 'value must be a non-negative number' });
      }
      updates.push('value = ?');
      values.push(numValue);
    }
    if (updates.length === 0) {
      return res.status(200).json({ success: true, data: target });
    }
    values.push(id);
    try {
      db.prepare(`UPDATE promo_codes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return res.status(400).json({ success: false, message: 'Promo code name already exists' });
      }
      throw e;
    }
    const updated = findPromoCodeById.get(id);
    return res.status(200).json({
      success: true,
      data: { id: updated.id, name: updated.name, value: updated.value, createdAt: updated.createdAt },
    });
  });

  app.delete('/api/admin/promo-codes/:id', auth, requireAdminOrSuper, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const target = findPromoCodeById.get(id);
    if (!target) return res.status(404).json({ success: false, message: 'Promo code not found' });
    db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
    return res.status(200).json({ success: true, message: 'Promo code deleted' });
  });
};
