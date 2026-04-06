const { verifyAdminToken } = require('./auth');
const { ROLES } = require('./seed');

function authenticateAdmin(JWT_SECRET) {
  return (req, res, next) => {
    const token = req.headers.authorization;
    const payload = verifyAdminToken(token, JWT_SECRET);
    if (!payload || !payload.adminId) {
      return res.status(401).json({ success: false, message: 'Invalid or missing admin token' });
    }
    req.admin = payload;
    next();
  };
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  return requireRole(ROLES.SUPERADMIN)(req, res, next);
}

function requireAdminOrSuper(req, res, next) {
  return requireRole(ROLES.SUPERADMIN, ROLES.ADMIN)(req, res, next);
}

function requireStoreAccess(getStoreIdFromRequest) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (req.admin.role === ROLES.SUPERADMIN || req.admin.role === ROLES.ADMIN) return next();
    const storeId = getStoreIdFromRequest(req);
    if (req.admin.role === ROLES.STORE_ADMIN && req.admin.storeId && String(req.admin.storeId) === String(storeId)) return next();
    return res.status(403).json({ success: false, message: 'Access denied to this store' });
  };
}

/** SuperAdmin, Admin, or Store Admin (dashboard activity log, etc.). */
function requireDashboardAdmin(req, res, next) {
  if (!req.admin) return res.status(401).json({ success: false, message: 'Not authenticated' });
  if (
    req.admin.role === ROLES.SUPERADMIN ||
    req.admin.role === ROLES.ADMIN ||
    req.admin.role === ROLES.STORE_ADMIN
  ) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Insufficient permissions' });
}

module.exports = {
  authenticateAdmin,
  requireRole,
  requireSuperAdmin,
  requireAdminOrSuper,
  requireStoreAccess,
  requireDashboardAdmin,
};
