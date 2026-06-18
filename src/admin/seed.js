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
      role TEXT NOT NULL,
      storeId TEXT,
      name TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  migrateAdminsRoleConstraint(db);
}

/**
 * Older databases created the admins table with a CHECK constraint limiting
 * role to ('superadmin','admin','store_admin'). Rebuild the table without that
 * constraint so the new staff roles can be stored.
 */
function migrateAdminsRoleConstraint(db) {
  try {
    const info = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='admins'")
      .get();
    if (!info || !info.sql || !/CHECK\s*\(\s*role\s+IN/i.test(info.sql)) return;
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE admins_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          role TEXT NOT NULL,
          storeId TEXT,
          name TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.exec(
        'INSERT INTO admins_new (id, email, passwordHash, role, storeId, name, createdAt) ' +
          'SELECT id, email, passwordHash, role, storeId, name, createdAt FROM admins;',
      );
      db.exec('DROP TABLE admins;');
      db.exec('ALTER TABLE admins_new RENAME TO admins;');
    });
    rebuild();
    console.log('Admin migration: removed role CHECK constraint to allow staff roles');
  } catch (e) {
    console.error('Admin migration (role constraint) failed:', e.message);
  }
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
  migrateAdminsRoleConstraint,
  seedSuperAdmin,
  seedAdmins,
};
