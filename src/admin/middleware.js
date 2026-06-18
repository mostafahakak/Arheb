const { verifyAdminToken } = require('./auth');
const { ROLES } = require('./seed');
const { roleHasAnyPermission, isFullAccessRole, STAFF_ROLES } = require('./permissions');

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

/**
 * Allow the request if the caller's role has ANY of the given permissions.
 * SuperAdmin and Admin always pass (full access). Store admins never pass these
 * staff-permission gates (their access is handled by requireStoreAccess).
 */
function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (isFullAccessRole(req.admin.role)) return next();
    if (roleHasAnyPermission(req.admin.role, permissions)) return next();
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
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

/**
 * Like requirePermission, but also lets the merchant store_admin through (their
 * access is scoped internally by the handler). Use for endpoints that both
 * merchants and staff use, such as orders and the stores list.
 */
function requirePermissionAllowStore(...permissions) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (isFullAccessRole(req.admin.role)) return next();
    if (req.admin.role === ROLES.STORE_ADMIN) return next();
    if (roleHasAnyPermission(req.admin.role, permissions)) return next();
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
}

/**
 * Store-scoped access for the merchant, OR a staff permission for staff roles.
 * Full-access roles always pass. Replaces requireStoreAccess on endpoints that
 * staff roles also need (store view/edit, products).
 */
function requireStoreAccessOrPermission(getStoreIdFromRequest, ...permissions) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (isFullAccessRole(req.admin.role)) return next();
    if (req.admin.role === ROLES.STORE_ADMIN) {
      const storeId = getStoreIdFromRequest(req);
      if (req.admin.storeId && String(req.admin.storeId) === String(storeId)) return next();
      return res.status(403).json({ success: false, message: 'Access denied to this store' });
    }
    if (roleHasAnyPermission(req.admin.role, permissions)) return next();
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
}

/** Any authenticated dashboard user (full-access, staff role, or store admin). */
function requireDashboardAdmin(req, res, next) {
  if (!req.admin) return res.status(401).json({ success: false, message: 'Not authenticated' });
  if (
    isFullAccessRole(req.admin.role) ||
    req.admin.role === ROLES.STORE_ADMIN ||
    STAFF_ROLES.includes(req.admin.role)
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
  requirePermission,
  requirePermissionAllowStore,
  requireStoreAccess,
  requireStoreAccessOrPermission,
  requireDashboardAdmin,
};
