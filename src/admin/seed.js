const {
  hashPassword,
} = require('./auth');

const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  STORE_ADMIN: 'store_admin',
});

function createAdminsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'store_admin')),
      storeId TEXT,
      name TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedSuperAdmin(db, email, password) {
  if (!email || !password) {
    console.warn('Admin seed: SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set to create initial SuperAdmin');
    return;
  }
  const existing = db.prepare("SELECT id FROM admins WHERE role = 'superadmin' LIMIT 1").get();
  if (existing) {
    return;
  }
  const passwordHash = hashPassword(password);
  db.prepare(
    `INSERT INTO admins (email, passwordHash, role) VALUES (?, ?, 'superadmin')`
  ).run(email, passwordHash);
  console.log('Admin seed: Initial SuperAdmin created for', email);
}

function seedAdmins(db) {
  createAdminsTable(db);
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  seedSuperAdmin(db, email, password);
}

module.exports = {
  ROLES,
  createAdminsTable,
  seedSuperAdmin,
  seedAdmins,
};
