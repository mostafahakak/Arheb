/**
 * Merchant / store-admin presence over Socket.IO.
 *
 * When a store admin opens the dashboard, they connect to /merchant-presence
 * with their admin JWT. The server tracks which admins are online so that
 * SuperAdmin / Admin can see real-time "live" status for each store.
 *
 * Namespace: /merchant-presence
 * Auth: handshake.auth.token (admin JWT)
 * Events:
 *   server -> client: "connected" { adminId, storeId }
 *   server -> admin-room: "merchant_presence_update" { onlineMerchants: [...] }
 */

const jwt = require('jsonwebtoken');

// adminId -> { socketId, storeId, role, lastSeen }
const onlineMerchants = new Map();

function getOnlineMerchants() {
  const list = [];
  const now = Date.now();
  const staleMs = 5 * 60 * 1000;
  for (const [adminId, v] of onlineMerchants.entries()) {
    if (now - new Date(v.lastSeen).getTime() > staleMs) continue;
    list.push({
      adminId: parseInt(adminId, 10),
      storeId: v.storeId ?? null,
      role: v.role ?? null,
      lastSeen: v.lastSeen,
    });
  }
  return list;
}

function isStoreAdminOnline(storeId) {
  if (storeId == null) return false;
  for (const [, v] of onlineMerchants.entries()) {
    if (String(v.storeId) === String(storeId)) {
      const age = Date.now() - new Date(v.lastSeen).getTime();
      if (age < 5 * 60 * 1000) return true;
    }
  }
  return false;
}

function broadcastPresenceToAdmins(io) {
  try {
    const nsp = io.of('/merchant-presence');
    const list = getOnlineMerchants();
    nsp.to('admin_watchers').emit('merchant_presence_update', { onlineMerchants: list });
  } catch (e) { /* ignore */ }
}

module.exports = function attachMerchantPresence(io, db, JWT_SECRET) {
  const nsp = io.of('/merchant-presence');

  nsp.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
    if (!token) return next(new Error('Token required'));
    const clean = (typeof token === 'string' ? token : '').replace(/Bearer\s+/i, '').trim();
    try {
      const payload = jwt.verify(clean, JWT_SECRET);
      if (!payload.adminId) return next(new Error('Invalid admin token'));
      socket.adminId = payload.adminId;
      socket.adminRole = payload.role ?? null;
      socket.storeId = payload.storeId ?? null;
      next();
    } catch (e) {
      next(new Error('Invalid or expired token'));
    }
  });

  nsp.on('connection', (socket) => {
    const adminId = socket.adminId;
    const role = socket.adminRole;
    const storeId = socket.storeId;

    onlineMerchants.set(adminId, {
      socketId: socket.id,
      storeId,
      role,
      lastSeen: new Date().toISOString(),
    });

    if (role === 'superadmin' || role === 'admin') {
      socket.join('admin_watchers');
    }

    socket.emit('connected', { adminId, storeId, message: 'Merchant presence registered' });
    broadcastPresenceToAdmins(io);

    socket.on('heartbeat', () => {
      const cur = onlineMerchants.get(adminId);
      if (cur) {
        cur.lastSeen = new Date().toISOString();
      }
      socket.emit('heartbeat_ack', { success: true });
    });

    socket.on('disconnect', () => {
      onlineMerchants.delete(adminId);
      broadcastPresenceToAdmins(io);
    });
  });

  return {
    getOnlineMerchants,
    isStoreAdminOnline,
    onlineMerchants,
  };
};

module.exports.getOnlineMerchants = getOnlineMerchants;
module.exports.isStoreAdminOnline = isStoreAdminOnline;
