const jwt = require('jsonwebtoken');

const ADMIN_DASHBOARD_NS = '/admin-dashboard';
/** Room joined by all authenticated dashboard clients listening for list refreshes. */
const ADMIN_ORDERS_ROOM = 'orders_listeners';

/**
 * Admin dashboard real-time: JWT must be a signed admin token ({ adminId, ... }).
 */
function attachAdminDashboardNamespace(io, jwtSecret) {
  if (!io || !jwtSecret) return;
  const nsp = io.of(ADMIN_DASHBOARD_NS);
  nsp.use((socket, next) => {
    try {
      const raw = socket.handshake.auth?.token ?? socket.handshake.query?.token;
      if (!raw || typeof raw !== 'string') return next(new Error('unauthorized'));
      const clean = raw.replace(/^Bearer\s+/i, '').trim();
      const payload = jwt.verify(clean, jwtSecret);
      if (payload.adminId == null) return next(new Error('unauthorized'));
      return next();
    } catch (e) {
      return next(new Error('unauthorized'));
    }
  });
  nsp.on('connection', (socket) => {
    socket.join(ADMIN_ORDERS_ROOM);
  });
}

module.exports = {
  attachAdminDashboardNamespace,
  ADMIN_DASHBOARD_NS,
  ADMIN_ORDERS_ROOM,
};
