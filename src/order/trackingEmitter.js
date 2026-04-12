/**
 * Shared Socket.IO reference so driver (and admin) can emit to order tracking rooms
 * without coupling driver/admin routes to the order module.
 * Set by attachOrderTrackingRoutes; used by driver accept/complete and admin status update.
 */
const { ADMIN_DASHBOARD_NS, ADMIN_ORDERS_ROOM } = require('../utils/adminDashboardSocket');

let _io = null;

function setOrderTrackingIo(io) {
  _io = io;
}

function getTrackingIo() {
  return _io;
}

/** Notify dashboard list pages (orders + Arheb Box) to refetch — e.g. new checkout order before any status event. */
function emitAdminOrdersListUpdated(extra = {}) {
  if (!_io) return;
  try {
    _io.of(ADMIN_DASHBOARD_NS)
      .to(ADMIN_ORDERS_ROOM)
      .emit('orders_updated', { ts: Date.now(), ...extra });
  } catch (e) {
    /* ignore */
  }
}

function emitOrderEvent(orderId, event, data) {
  if (_io && orderId != null) {
    _io.to(`order:${orderId}`).emit(event, { orderId, ...data });
    emitAdminOrdersListUpdated({ kind: 'store_order', orderId, event, ...data });
  }
}

function emitArhebBoxEvent(requestId, event, data) {
  if (_io && requestId != null) {
    _io.to(`arheb_box:${requestId}`).emit(event, { requestId, ...data });
    emitAdminOrdersListUpdated({ kind: 'arheb_box', requestId, event, ...data });
  }
}

module.exports = {
  setOrderTrackingIo,
  getTrackingIo,
  emitOrderEvent,
  emitArhebBoxEvent,
  emitAdminOrdersListUpdated,
};
