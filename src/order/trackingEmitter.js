/**
 * Shared Socket.IO reference so driver (and admin) can emit to order tracking rooms
 * without coupling driver/admin routes to the order module.
 * Set by attachOrderTrackingRoutes; used by driver accept/complete and admin status update.
 */
let _io = null;

function setOrderTrackingIo(io) {
  _io = io;
}

function getTrackingIo() {
  return _io;
}

function emitOrderEvent(orderId, event, data) {
  if (_io && orderId != null) {
    _io.to(`order:${orderId}`).emit(event, { orderId, ...data });
  }
}

function emitArhebBoxEvent(requestId, event, data) {
  if (_io && requestId != null) {
    _io.to(`arheb_box:${requestId}`).emit(event, { requestId, ...data });
  }
}

module.exports = {
  setOrderTrackingIo,
  getTrackingIo,
  emitOrderEvent,
  emitArhebBoxEvent,
};
