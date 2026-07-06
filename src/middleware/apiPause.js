const { verifyAdminToken } = require('../admin/auth');
const { isApiPaused } = require('../utils/apiPause');

const PAUSE_RESPONSE = {
  success: false,
  code: 'API_PAUSED',
  message: 'The platform is temporarily paused. New requests are not accepted. Please try again later.',
};

/**
 * When App info "Pause all APIs" is on (or ARHEB_API_PAUSED env), reject most traffic with 503.
 * Allowlist: health, admin login, authenticated admin dashboard APIs, payment callbacks/return,
 * and read-only contact/app_version so apps can show a maintenance message.
 */
function createApiPauseMiddleware(db, JWT_SECRET) {
  return function apiPauseMiddleware(req, res, next) {
    if (!isApiPaused(db)) return next();

    const path = req.path || '';
    const method = String(req.method || 'GET').toUpperCase();

    if (path === '/' || path === '/health' || path === '/healthz') return next();
    if (path.startsWith('/test-client')) return next();

    if (method === 'POST' && path === '/api/admin/login') return next();

    if (path === '/api/payment/callback' || path === '/api/payment/return') return next();

    if (
      method === 'GET' &&
      (path === '/api/contact' || path === '/api/app_version' || path === '/app_version')
    ) {
      return next();
    }

    if (path.startsWith('/api/admin/')) {
      const payload = verifyAdminToken(req.headers.authorization, JWT_SECRET);
      if (payload && payload.adminId) return next();
    }

    return res.status(503).json(PAUSE_RESPONSE);
  };
}

module.exports = { createApiPauseMiddleware, PAUSE_RESPONSE };
