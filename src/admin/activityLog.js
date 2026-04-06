const { ROLES } = require('./seed');

function sameStoreScope(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function ensureActivityLogTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,
      adminId INTEGER NOT NULL,
      adminEmail TEXT,
      adminName TEXT,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      resourceType TEXT NOT NULL,
      resourceId TEXT,
      storeScopeId TEXT,
      summary TEXT,
      detailsJson TEXT
    );
  `);
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_created ON admin_activity_log(createdAt DESC)');
  } catch (e) {
    /* ignore */
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_store ON admin_activity_log(storeScopeId)');
  } catch (e) {
    /* ignore */
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_admin ON admin_activity_log(adminId)');
  } catch (e) {
    /* ignore */
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_action ON admin_activity_log(action)');
  } catch (e) {
    /* ignore */
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_activity_resource ON admin_activity_log(resourceType)');
  } catch (e) {
    /* ignore */
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').Request} req
 * @param {{ action: 'add'|'edit'|'delete', resourceType: string, resourceId?: string|null, storeScopeId?: string|null, summary?: string, details?: object }} row
 */
function logActivity(db, req, row) {
  if (!req || !req.admin) return;
  try {
    const a = db.prepare('SELECT id, email, name, role, storeId FROM admins WHERE id = ?').get(req.admin.adminId);
    if (!a) return;
    const detailsJson = row.details && typeof row.details === 'object' ? JSON.stringify(row.details) : null;
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO admin_activity_log (
        createdAt, adminId, adminEmail, adminName, role, action, resourceType, resourceId, storeScopeId, summary, detailsJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      createdAt,
      a.id,
      a.email ?? null,
      a.name ?? null,
      a.role,
      row.action,
      row.resourceType,
      row.resourceId != null && String(row.resourceId).trim() !== '' ? String(row.resourceId).trim() : null,
      row.storeScopeId != null && String(row.storeScopeId).trim() !== '' ? String(row.storeScopeId).trim() : null,
      row.summary != null ? String(row.summary).slice(0, 500) : null,
      detailsJson,
    );
  } catch (e) {
    console.error('logActivity:', e.message);
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function handleActivityLogList(db, req, res) {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(String(req.query.perPage || '25'), 10) || 25));
    const offset = (page - 1) * perPage;

    const conditions = [];
    const params = [];

    /* Store Admin: only their own actions (not other admins). Admin/SuperAdmin: full log. */
    if (req.admin.role === ROLES.STORE_ADMIN) {
      conditions.push('adminId = ?');
      params.push(req.admin.adminId);
    }

    if (req.query.storeId != null && String(req.query.storeId).trim() !== '') {
      if (req.admin.role === ROLES.STORE_ADMIN) {
        if (!sameStoreScope(req.admin.storeId, req.query.storeId)) {
          return res.status(403).json({ success: false, message: 'Cannot filter by another store' });
        }
      }
      conditions.push('storeScopeId = ?');
      params.push(String(req.query.storeId).trim());
    }

    if (req.query.action != null && String(req.query.action).trim() !== '') {
      const act = String(req.query.action).trim().toLowerCase();
      if (['add', 'edit', 'delete'].includes(act)) {
        conditions.push('action = ?');
        params.push(act);
      }
    }

    if (req.query.resourceType != null && String(req.query.resourceType).trim() !== '') {
      conditions.push('resourceType = ?');
      params.push(String(req.query.resourceType).trim());
    }

    if (req.query.adminId != null && String(req.query.adminId).trim() !== '') {
      if (req.admin.role === ROLES.STORE_ADMIN) {
        return res.status(403).json({ success: false, message: 'Cannot filter by admin id' });
      }
      const aid = parseInt(String(req.query.adminId).trim(), 10);
      if (!isNaN(aid)) {
        conditions.push('adminId = ?');
        params.push(aid);
      }
    }

    if (req.query.dateFrom != null && String(req.query.dateFrom).trim() !== '') {
      conditions.push('date(createdAt) >= date(?)');
      params.push(String(req.query.dateFrom).trim());
    }
    if (req.query.dateTo != null && String(req.query.dateTo).trim() !== '') {
      conditions.push('date(createdAt) <= date(?)');
      params.push(String(req.query.dateTo).trim());
    }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const countRow = db.prepare('SELECT COUNT(*) AS n FROM admin_activity_log' + where).get(...params);
    const total = countRow?.n ?? 0;

    const rows = db
      .prepare(
        'SELECT * FROM admin_activity_log' +
          where +
          ' ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?',
      )
      .all(...params, perPage, offset);

    const activities = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      adminId: r.adminId,
      adminEmail: r.adminEmail,
      adminName: r.adminName,
      role: r.role,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      storeScopeId: r.storeScopeId,
      summary: r.summary,
      details: (() => {
        try {
          return r.detailsJson ? JSON.parse(r.detailsJson) : null;
        } catch {
          return null;
        }
      })(),
    }));

    return res.status(200).json({
      success: true,
      data: {
        activities,
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage) || 0,
      },
    });
  } catch (e) {
    console.error('activity log list:', e);
    return res.status(500).json({ success: false, message: 'Failed to load activity log' });
  }
}

module.exports = {
  ensureActivityLogTable,
  logActivity,
  handleActivityLogList,
};
