/**
 * Driver presence over Socket.IO: drivers connect when "active" (app open)
 * and send location updates. Admin can see who is online and nearest to a store.
 *
 * Namespace: /driver-presence
 * Auth: handshake.auth.token (driver JWT)
 * Events: client emits "location" { latitude, longitude }; server stores and can expose via getActiveDriversWithLocation().
 */

const jwt = require('jsonwebtoken');
const fcm = require('./fcm');

// driverId -> { socketId, latitude, longitude, lastSeen }
const activeDrivers = new Map();

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * @param {number} driverId
 * @param {number} storeLat
 * @param {number} storeLong
 * @returns {number|null} distance in km or null if driver has no location
 */
function distanceFromStore(driverId, storeLat, storeLong) {
  const d = activeDrivers.get(driverId);
  if (!d || d.latitude == null || d.longitude == null) return null;
  return haversineKm(d.latitude, d.longitude, storeLat, storeLong);
}

/**
 * Get all active drivers with their last known location.
 * @returns {Array<{ driverId: number, socketId: string, latitude: number, longitude: number, lastSeen: string }>}
 */
function getActiveDriversWithLocation() {
  const list = [];
  const now = Date.now();
  const staleMs = 5 * 60 * 1000; // 5 min
  for (const [driverId, v] of activeDrivers.entries()) {
    if (now - new Date(v.lastSeen).getTime() > staleMs) continue;
    list.push({
      driverId: parseInt(driverId, 10),
      socketId: v.socketId,
      latitude: v.latitude,
      longitude: v.longitude,
      lastSeen: v.lastSeen,
    });
  }
  return list;
}

/**
 * Get active driver IDs that are in the given list and optionally sort by distance to store.
 * @param {number[]} driverIds - candidate driver IDs (e.g. from DB, not blocked)
 * @param {number|null} storeLat
 * @param {number|null} storeLong
 * @returns {Array<{ driverId: number, latitude: number, longitude: number, lastSeen: string, distanceKm?: number }>}
 */
function getActiveFromListWithDistance(driverIds, storeLat, storeLong) {
  const activeSet = new Set(activeDrivers.keys());
  const list = [];
  for (const id of driverIds) {
    const d = activeDrivers.get(id);
    if (!d) continue;
    const lastSeen = d.lastSeen;
    const now = Date.now();
    if (now - new Date(lastSeen).getTime() > 5 * 60 * 1000) continue;
    const lat = d.latitude;
    const lon = d.longitude;
    let distanceKm = null;
    if (storeLat != null && storeLong != null && lat != null && lon != null) {
      distanceKm = haversineKm(lat, lon, storeLat, storeLong);
    }
    list.push({
      driverId: id,
      latitude: lat,
      longitude: lon,
      lastSeen,
      distanceKm: distanceKm ?? undefined,
    });
  }
  if (storeLat != null && storeLong != null) {
    list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  return list;
}

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

module.exports = function attachDriverPresence(io, db, JWT_SECRET) {
  const findDriverById = db.prepare('SELECT id FROM drivers WHERE id = ? AND isBlocked = 0');
  const nsp = io.of('/driver-presence');

  nsp.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
    if (!token) return next(new Error('Token required'));
    const clean = (typeof token === 'string' ? token : '').replace(/Bearer\s+/i, '').trim();
    try {
      const payload = jwt.verify(clean, JWT_SECRET);
      if (!payload.driverId) return next(new Error('Invalid driver token'));
      const driver = findDriverById.get(payload.driverId);
      if (!driver) return next(new Error('Driver not found or blocked'));
      socket.driverId = payload.driverId;
      next();
    } catch (e) {
      next(new Error('Invalid or expired token'));
    }
  });

  nsp.on('connection', (socket) => {
    const driverId = socket.driverId;
    activeDrivers.set(driverId, {
      socketId: socket.id,
      latitude: null,
      longitude: null,
      lastSeen: new Date().toISOString(),
    });
    socket.emit('connected', { driverId, message: 'Driver presence registered' });

    socket.on('location', (data) => {
      // Accept numbers or numeric strings (mobile JSON often sends doubles as strings).
      const lat = Number(data?.latitude);
      const lon = Number(data?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        socket.emit('error', { message: 'Invalid latitude/longitude' });
        return;
      }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        socket.emit('error', { message: 'Invalid latitude/longitude' });
        return;
      }
      const cur = activeDrivers.get(driverId);
      if (cur) {
        cur.latitude = lat;
        cur.longitude = lon;
        cur.lastSeen = new Date().toISOString();
      }
      try {
        const { broadcastDriverPresenceLocation } = require('./order');
        if (typeof broadcastDriverPresenceLocation === 'function') {
          broadcastDriverPresenceLocation(io, db, driverId, lat, lon);
        }
      } catch (e) {
        /* ignore */
      }
      // Notify customer once when driver is within 0.5km of delivery location.
      try {
        const rows = db.prepare(`
          SELECT id, phoneNumber, addressLat, addressLong, nearArrivalNotified
          FROM orders
          WHERE driverId = ?
            AND status = 'On the way'
        `).all(driverId);
        for (const order of rows) {
          const dLat = Number(order.addressLat);
          const dLong = Number(order.addressLong);
          if (!Number.isFinite(dLat) || !Number.isFinite(dLong)) continue;
          if (Number(order.nearArrivalNotified || 0) === 1) continue;
          const distanceKm = haversineKm(lat, lon, dLat, dLong);
          if (distanceKm <= 0.5) {
            db.prepare('UPDATE orders SET nearArrivalNotified = 1 WHERE id = ?').run(order.id);
            fcm.sendToUserByPhone(
              db,
              order.phoneNumber,
              'Order is near',
              `Order #${order.id} is about ${round3(distanceKm)} km away and will arrive soon.`,
              null,
              {
                orderId: String(order.id),
                status: 'On the way',
                type: 'order_near_arrival',
                distanceKm: String(round3(distanceKm)),
                screen: 'order_details',
                deepLink: `arheb://orders/${order.id}`,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
              }
            ).catch(() => {});
          }
        }
      } catch (e) {
        /* ignore near-arrival notifications */
      }
      socket.emit('location_ack', { success: true });
    });

    socket.on('disconnect', () => {
      activeDrivers.delete(driverId);
    });
  });

  return {
    getActiveDriversWithLocation,
    getActiveFromListWithDistance,
    activeDrivers,
  };
};

module.exports.getActiveDriversWithLocation = getActiveDriversWithLocation;
module.exports.getActiveFromListWithDistance = getActiveFromListWithDistance;
