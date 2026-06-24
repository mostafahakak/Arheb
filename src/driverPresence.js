/**
 * Driver presence over Socket.IO: drivers connect when "active" (app open)
 * and send location updates. Admin can see who is online and nearest to a store.
 *
 * Namespace: /driver-presence
 * Auth: handshake.auth.token (driver JWT)
 * Events: "location" or "driver_location" { latitude, longitude } (lat/lng also accepted); server stores and broadcasts to order/box tracking rooms.
 */

const jwt = require('jsonwebtoken');
const fcm = require('./fcm');

// driverId -> { socketId, latitude, longitude, lastSeen, lastHeavyAt }
const activeDrivers = new Map();

/**
 * Min interval between the DB-heavy parts of a driver's location update (row write, live-map
 * broadcasts, near-arrival scans). Live tracking stays smooth at ~4s; in-memory position is
 * still updated on every ping for nearest-driver matching.
 */
const PRESENCE_HEAVY_THROTTLE_MS = 4000;

/** Reject null island (0,0) and other placeholder coords apps/DB sometimes send before a real GPS fix. */
function isValidDriverGps(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return false;
  if (Math.abs(la) < 1e-6 && Math.abs(lo) < 1e-6) return false;
  return true;
}

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
  const d = activeDrivers.get(Number(driverId));
  if (!d || !isValidDriverGps(d.latitude, d.longitude)) return null;
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
      latitude: isValidDriverGps(v.latitude, v.longitude) ? v.latitude : null,
      longitude: isValidDriverGps(v.latitude, v.longitude) ? v.longitude : null,
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
  const list = [];
  for (const id of driverIds) {
    const nid = Number(id);
    if (!Number.isFinite(nid)) continue;
    const d = activeDrivers.get(nid);
    if (!d) continue;
    const lastSeen = d.lastSeen;
    const now = Date.now();
    if (now - new Date(lastSeen).getTime() > 5 * 60 * 1000) continue;
    const lat = d.latitude;
    const lon = d.longitude;
    const hasGps = isValidDriverGps(lat, lon);
    let distanceKm = null;
    if (storeLat != null && storeLong != null && hasGps) {
      distanceKm = haversineKm(lat, lon, storeLat, storeLong);
    }
    list.push({
      driverId: nid,
      latitude: hasGps ? lat : null,
      longitude: hasGps ? lon : null,
      lastSeen,
      distanceKm: distanceKm ?? undefined,
    });
  }
  if (storeLat != null && storeLong != null) {
    list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  return list;
}

/**
 * Real-time ping on /driver-presence so the app can show a request without relying on FCM alone.
 * @param {import('socket.io').Server} io
 * @param {number} driverId
 * @param {object} payload - e.g. { orderId, status, type, storeName, storeId }
 */
function emitDriverDeliveryRequest(io, driverId, payload) {
  if (!io || driverId == null) return false;
  const d = activeDrivers.get(Number(driverId));
  if (!d?.socketId) return false;
  try {
    io.of('/driver-presence').to(d.socketId).emit('delivery_request', payload);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Broadcast to ALL online drivers that available orders have changed.
 * The driver app should re-fetch its orders list on receiving this event.
 */
function broadcastDriverOrdersUpdated(io, payload) {
  if (!io) return;
  try {
    io.of('/driver-presence').emit('orders_updated', payload || { type: 'refresh' });
  } catch (e) { /* ignore */ }
}

/**
 * Emit to one driver’s /driver-presence socket (reassign: old driver must drop job from home; new driver must see it).
 */
function emitDriverPresenceEvent(io, driverId, eventName, payload) {
  if (!io || driverId == null) return false;
  const d = activeDrivers.get(Number(driverId));
  if (!d?.socketId) return false;
  try {
    io.of('/driver-presence').to(d.socketId).emit(eventName, payload || {});
    return true;
  } catch (e) {
    return false;
  }
}

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

module.exports = function attachDriverPresence(io, db, JWT_SECRET) {
  const findDriverById = db.prepare('SELECT id, latitude, longitude FROM drivers WHERE id = ? AND isBlocked = 0');
  const nsp = io.of('/driver-presence');

  nsp.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
    if (!token) return next(new Error('Token required'));
    const clean = (typeof token === 'string' ? token : '').replace(/Bearer\s+/i, '').trim();
    try {
      const payload = jwt.verify(clean, JWT_SECRET);
      if (!payload.driverId) return next(new Error('Invalid driver token'));
      const driverId = Number(payload.driverId);
      if (!Number.isFinite(driverId)) return next(new Error('Invalid driver token'));
      const driver = findDriverById.get(driverId);
      if (!driver) return next(new Error('Driver not found or blocked'));
      socket.driverId = driverId;
      next();
    } catch (e) {
      next(new Error('Invalid or expired token'));
    }
  });

  nsp.on('connection', (socket) => {
    const driverId = socket.driverId;
    let seedLat = null;
    let seedLon = null;
    try {
      const row = findDriverById.get(driverId);
      if (row) {
        const la = Number(row.latitude);
        const lo = Number(row.longitude);
        if (Number.isFinite(la) && Number.isFinite(lo) && isValidDriverGps(la, lo)) {
          seedLat = la;
          seedLon = lo;
        }
      }
    } catch (e) {
      /* ignore */
    }
    activeDrivers.set(driverId, {
      socketId: socket.id,
      latitude: seedLat,
      longitude: seedLon,
      lastSeen: new Date().toISOString(),
    });
    socket.emit('connected', { driverId, message: 'Driver presence registered' });

    function applyPresenceLocation(data) {
      const lat = Number(data?.latitude ?? data?.lat);
      const lon = Number(data?.longitude ?? data?.lng ?? data?.long);
      if (!isValidDriverGps(lat, lon)) {
        socket.emit('error', { message: 'Invalid latitude/longitude (GPS fix required)' });
        return;
      }
      const cur = activeDrivers.get(driverId);
      if (cur) {
        cur.latitude = lat;
        cur.longitude = lon;
        cur.lastSeen = new Date().toISOString();
      }

      // Throttle the DB-heavy work (driver row write, tracking broadcasts, near-arrival scans)
      // to at most once per PRESENCE_HEAVY_THROTTLE_MS PER DRIVER. The in-memory position above
      // is always current for nearest-driver matching; only the expensive synchronous SQLite
      // work is rate-limited so a burst of location pings can't freeze the event loop.
      const now = Date.now();
      if (cur && cur.lastHeavyAt && now - cur.lastHeavyAt < PRESENCE_HEAVY_THROTTLE_MS) {
        socket.emit('location_ack', { success: true, throttled: true });
        return;
      }
      if (cur) cur.lastHeavyAt = now;

      try {
        db.prepare('UPDATE drivers SET latitude = ?, longitude = ? WHERE id = ?').run(lat, lon, driverId);
      } catch (e) {
        /* ignore if columns missing */
      }
      try {
        const { broadcastDriverPresenceLocation } = require('./order');
        if (typeof broadcastDriverPresenceLocation === 'function') {
          broadcastDriverPresenceLocation(io, db, driverId, lat, lon);
        }
      } catch (e) {
        /* ignore */
      }
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

      try {
        const boxRows = db.prepare(`
          SELECT id, phoneNumber, dropoff, nearArrivalNotified
          FROM arheb_box_requests
          WHERE driverId = ?
            AND LOWER(TRIM(status)) IN ('on_the_way', 'in_progress')
        `).all(driverId);
        for (const box of boxRows) {
          if (Number(box.nearArrivalNotified || 0) === 1) continue;
          let dropoff;
          try {
            dropoff = JSON.parse(box.dropoff);
          } catch (_) {
            continue;
          }
          const dLat = Number(dropoff?.latitude ?? dropoff?.lat);
          const dLon = Number(dropoff?.longitude ?? dropoff?.lng ?? dropoff?.long);
          if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) continue;
          const distanceKm = haversineKm(lat, lon, dLat, dLon);
          if (distanceKm <= 0.5) {
            db.prepare('UPDATE arheb_box_requests SET nearArrivalNotified = 1 WHERE id = ?').run(box.id);
            fcm.sendToUserByPhone(
              db,
              box.phoneNumber,
              'Your parcel is almost there!',
              `Arheb Box #${box.id} is about ${round3(distanceKm)} km away and will arrive soon.`,
              null,
              {
                requestId: String(box.id),
                status: 'on_the_way',
                type: 'arheb_box_near_arrival',
                distanceKm: String(round3(distanceKm)),
                screen: 'arheb_box_details',
                deepLink: `arheb://arheb-box/${box.id}`,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
              }
            ).catch(() => {});
          }
        }
      } catch (e) {
        /* ignore box near-arrival — table may not exist yet */
      }
      socket.emit('location_ack', { success: true });
    }

    socket.on('location', (data) => applyPresenceLocation(data));
    socket.on('driver_location', (data) => applyPresenceLocation(data));

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
module.exports.isValidDriverGps = isValidDriverGps;
module.exports.emitDriverDeliveryRequest = emitDriverDeliveryRequest;
module.exports.broadcastDriverOrdersUpdated = broadcastDriverOrdersUpdated;
module.exports.emitDriverPresenceEvent = emitDriverPresenceEvent;
module.exports.haversineKm = haversineKm;
