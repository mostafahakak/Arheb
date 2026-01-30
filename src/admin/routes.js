const fs = require('fs');
const path = require('path');
const {
  hashPassword,
  comparePassword,
  signAdminToken,
  verifyAdminToken,
} = require('./auth');
const { seedAdmins, ROLES } = require('./seed');
const {
  authenticateAdmin,
  requireRole,
  requireSuperAdmin,
  requireAdminOrSuper,
  requireStoreAccess,
} = require('./middleware');

const storesResponsePath = path.resolve(__dirname, '..', '..', 'Arheb API JSON', 'stores_listing_response.json');
const productsResponsePath = path.resolve(__dirname, '..', '..', 'Arheb API JSON', 'products_listing_response.json');
const categoriesResponsePath = path.resolve(__dirname, '..', '..', 'Arheb API JSON', 'categories_response.json');

function loadStores() {
  try {
    const raw = fs.readFileSync(storesResponsePath, 'utf-8');
    const data = JSON.parse(raw);
    return data?.data?.stores ?? [];
  } catch (e) {
    return [];
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
    if (req.admin.role === ROLES.STORE_ADMIN) {
      const filtered = stores.filter((s) => s.id === req.admin.storeId);
      return res.status(200).json({ success: true, data: { stores: filtered } });
    }
    return res.status(200).json({ success: true, data: { stores } });
  });

  app.get('/api/admin/stores/:id', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const stores = loadStores();
    const store = stores.find((s) => s.id === req.params.id);
    if (!store) return res.status(404).json({ success: false, message: 'Store not found' });
    return res.status(200).json({ success: true, data: { store } });
  });

  app.patch('/api/admin/stores/:id', auth, requireStoreAccess((req) => req.params.id), (req, res) => {
    const stores = loadStores();
    const idx = stores.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Store not found' });
    const allowed = ['name', 'nameAr', 'nameEn', 'cover', 'logo', 'deliveryTime', 'deliveryFee', 'minimumOrder', 'isOpen', 'openingHours', 'address', 'addressAr', 'addressEn', 'phone', 'category', 'categoryAr', 'categoryEn'];
    const body = req.body || {};
    if (body.isPremium !== undefined) {
      if (req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Only SuperAdmin or Admin can set premium' });
      }
      stores[idx].isPremium = Boolean(body.isPremium);
    }
    for (const key of allowed) {
      if (body[key] !== undefined) stores[idx][key] = body[key];
    }
    saveStores(stores);
    return res.status(200).json({ success: true, data: { store: stores[idx] } });
  });

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
    const products = loadProducts();
    const body = req.body || {};
    const id = String(products.length ? Math.max(...products.map((p) => parseInt(p.id, 10) || 0)) + 1 : 1);
    const newProduct = {
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
    products.push(newProduct);
    saveProducts(products);
    return res.status(201).json({ success: true, data: { product: newProduct } });
  });

  app.patch('/api/admin/stores/:storeId/products/:productId', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId, productId } = req.params;
    const products = loadProducts();
    const idx = products.findIndex((p) => p.id === productId && p.store?.id === storeId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Product not found' });
    const allowed = ['name', 'nameAr', 'nameEn', 'image', 'images', 'price', 'originalPrice', 'discount', 'unit', 'unitAr', 'unitEn', 'category', 'categoryAr', 'categoryEn', 'description', 'descriptionAr', 'descriptionEn', 'stock', 'isAvailable'];
    const body = req.body || {};
    for (const key of allowed) {
      if (body[key] !== undefined) products[idx][key] = body[key];
    }
    saveProducts(products);
    return res.status(200).json({ success: true, data: { product: products[idx] } });
  });

  app.delete('/api/admin/stores/:storeId/products/:productId', auth, requireStoreAccess((req) => req.params.storeId), (req, res) => {
    const { storeId, productId } = req.params;
    const products = loadProducts();
    const idx = products.findIndex((p) => p.id === productId && p.store?.id === storeId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Product not found' });
    products.splice(idx, 1);
    saveProducts(products);
    return res.status(200).json({ success: true, message: 'Product deleted' });
  });

  // ——— Orders (sorted newest first; filter by date range, status, store, name) ———
  app.get('/api/admin/orders', auth, (req, res) => {
    const { dateFrom, dateTo, status, storeId, storeName, name } = req.query;
    const conditions = [];
    const params = [];

    if (req.admin.role === ROLES.STORE_ADMIN) {
      conditions.push('storeId = ?');
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

  app.patch('/api/admin/orders/:orderId/status', auth, (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ success: false, message: 'Invalid order ID' });
    const order = findOrderById.get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.admin.role === ROLES.STORE_ADMIN && order.storeId !== req.admin.storeId) {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }
    const { status } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status.trim(), orderId);
    const updated = findOrderById.get(orderId);
    const items = findOrderItems.all(orderId);
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

  // ——— Dashboard sales ———
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
    return res.status(200).json({
      success: true,
      data: {
        totalOrders: orders.length,
        totalRevenue,
        byStatus,
        recentOrders: recent,
      },
    });
  });

  // ——— Arheb Box requests (admin can list and update status) ———
  app.get('/api/admin/arheb-box', auth, (req, res) => {
    try {
      const rows = db.prepare(
        'SELECT id, phoneNumber, userName, pickup, dropoff, notes, status, createdAt FROM arheb_box_requests ORDER BY createdAt DESC, id DESC'
      ).all();
      const requests = rows.map((r) => ({
        id: r.id,
        phoneNumber: r.phoneNumber,
        userName: r.userName,
        pickup: (() => { try { return JSON.parse(r.pickup); } catch (e) { return {}; } })(),
        dropoff: (() => { try { return JSON.parse(r.dropoff); } catch (e) { return {}; } })(),
        notes: r.notes,
        status: r.status,
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
      const run = db.prepare('UPDATE arheb_box_requests SET status = ? WHERE id = ?').run(status.trim(), id);
      if (run.changes === 0) {
        return res.status(404).json({ success: false, message: 'Arheb box request not found' });
      }
      const row = db.prepare('SELECT id, phoneNumber, userName, pickup, dropoff, notes, status, createdAt FROM arheb_box_requests WHERE id = ?').get(id);
      const request = {
        id: row.id,
        phoneNumber: row.phoneNumber,
        userName: row.userName,
        pickup: (() => { try { return JSON.parse(row.pickup); } catch (e) { return {}; } })(),
        dropoff: (() => { try { return JSON.parse(row.dropoff); } catch (e) { return {}; } })(),
        notes: row.notes,
        status: row.status,
        createdAt: row.createdAt,
      };
      return res.status(200).json({ success: true, data: { request } });
    } catch (e) {
      console.error('Arheb box update error:', e);
      return res.status(500).json({ success: false, message: 'Failed to update' });
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
      name: body.name ?? '',
      nameAr: body.nameAr ?? body.name ?? '',
      nameEn: body.nameEn ?? body.name ?? '',
      image: body.image ?? null,
      isComingSoon: Boolean(body.isComingSoon),
      order: body.order ?? categories.length + 1,
      subCategories: Array.isArray(body.subCategories) ? body.subCategories : [],
    };
    categories.push(newCat);
    saveCategories(categories);
    return res.status(201).json({ success: true, data: { category: newCat } });
  });

  app.patch('/api/admin/categories/:id', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const idx = categories.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Category not found' });
    const allowed = ['name', 'nameAr', 'nameEn', 'image', 'isComingSoon', 'order', 'subCategories'];
    const body = req.body || {};
    for (const key of allowed) {
      if (body[key] !== undefined) categories[idx][key] = body[key];
    }
    saveCategories(categories);
    return res.status(200).json({ success: true, data: { category: categories[idx] } });
  });

  app.delete('/api/admin/categories/:id', auth, requireAdminOrSuper, (req, res) => {
    const categories = loadCategories();
    const idx = categories.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Category not found' });
    categories.splice(idx, 1);
    saveCategories(categories);
    return res.status(200).json({ success: true, message: 'Category deleted' });
  });
};
