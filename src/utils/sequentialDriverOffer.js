/**
 * Sequential “nearest online driver” chain for store orders (Preparing, no driver yet).
 * One pending invite at a time; on reject, offer the next nearest driver connected to /driver-presence.
 */

const fcm = require('../fcm');
const { emitDriverDeliveryRequest } = require('../driverPresence');

function parseLatLongFromGoogleMapsUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const text = url.trim();
  const patterns = [
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const latitude = Number(m[1]);
      const longitude = Number(m[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  }
  return null;
}

function getStoreForOrder(order, loadStores) {
  if (!order?.storeId) return null;
  const stores = loadStores();
  return stores.find((s) => String(s.id) === String(order.storeId)) || null;
}

function getStoreLatLong(store, parseFn = parseLatLongFromGoogleMapsUrl) {
  if (!store) return { storeLat: null, storeLong: null };
  const parsed = parseFn(store?.mapsUrl);
  const storeLat =
    store.latitude != null || store.lat != null ? Number(store.latitude ?? store.lat) : (parsed?.latitude ?? null);
  const storeLong =
    store.longitude != null || store.long != null ? Number(store.longitude ?? store.long) : (parsed?.longitude ?? null);
  return { storeLat, storeLong };
}

function fcmPayloadForDriverRequest(order, store, orderId) {
  return {
    orderId: String(orderId),
    status: 'Preparing',
    storeId: String(order.storeId || ''),
    storeName: String(store?.nameEn || store?.name || store?.nameAr || ''),
    storeMapsUrl: String(store?.mapsUrl || ''),
    type: 'driver_request',
    screen: 'order_details',
    deepLink: `arheb://orders/${orderId}`,
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
  };
}

/**
 * Insert pending request row, FCM + socket to driver.
 * @returns {{ notified: boolean, reason?: string }}
 */
function notifyDriverDeliveryRequest(db, io, orderId, order, driverId, store) {
  const existing = db.prepare('SELECT status FROM driver_requests WHERE orderId = ? AND driverId = ?').get(orderId, driverId);
  if (existing?.status === 'pending') {
    return { notified: false, reason: 'already_pending' };
  }
  if (existing?.status === 'rejected' || existing?.status === 'accepted') {
    return { notified: false, reason: `already_${existing.status}` };
  }
  db.prepare('INSERT INTO driver_requests (orderId, driverId, status) VALUES (?, ?, ?)').run(orderId, driverId, 'pending');

  fcm
    .sendToDriver(
      db,
      driverId,
      'New delivery assigned',
      `Order #${orderId} from ${store?.nameEn || store?.name || store?.nameAr || 'store'} has been auto-assigned to you. Open the app to accept.`,
      fcmPayloadForDriverRequest(order, store, orderId)
    )
    .catch(() => {});

  emitDriverDeliveryRequest(io, driverId, {
    orderId,
    status: 'Preparing',
    storeId: order.storeId,
    storeName: store?.nameEn || store?.name || store?.nameAr || '',
    type: 'driver_request',
  });

  return { notified: true };
}

function countPendingDriverRequests(db, orderId) {
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM driver_requests WHERE orderId = ? AND status = ?').get(orderId, 'pending')?.n ?? 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Next nearest **online** (socket presence) driver who has not rejected this order yet.
 * @returns {null | { driverId: number, distanceKm?: number }}
 */
function offerNextSequentialDriver(db, io, orderId, order, ctx) {
  const { loadStores, getActiveFromListWithDistance, parseLatLongFromGoogleMapsUrl: parseFn } = ctx;
  const parseLat = parseFn || parseLatLongFromGoogleMapsUrl;
  if (!order || order.driverId != null) return null;

  let drivers = [];
  try {
    drivers = db.prepare('SELECT id FROM drivers WHERE isBlocked = 0').all();
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) throw e;
  }
  const candidateIds = drivers.map((d) => d.id);
  const store = getStoreForOrder(order, loadStores);
  const { storeLat, storeLong } = getStoreLatLong(store, parseLat);
  const withDistance = getActiveFromListWithDistance(candidateIds, storeLat, storeLong);

  let rejectedRows = [];
  try {
    rejectedRows = db.prepare('SELECT driverId FROM driver_requests WHERE orderId = ? AND status = ?').all(orderId, 'rejected');
  } catch (e) {
    rejectedRows = [];
  }
  const rejected = new Set(rejectedRows.map((x) => x.driverId));

  for (const d of withDistance) {
    if (rejected.has(d.driverId)) continue;
    const n = notifyDriverDeliveryRequest(db, io, orderId, order, d.driverId, store);
    if (n.notified) {
      return { driverId: d.driverId, distanceKm: d.distanceKm };
    }
  }
  return null;
}

/**
 * Notify ALL non-blocked online drivers about a new order request.
 * Creates a driver_requests row for each and sends FCM + socket.
 */
function notifyAllOnlineDrivers(db, io, orderId, order, store, ctx) {
  const { getActiveFromListWithDistance } = ctx;
  let drivers = [];
  try {
    drivers = db.prepare('SELECT id FROM drivers WHERE isBlocked = 0').all();
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) throw e;
  }
  const candidateIds = drivers.map((d) => d.id);
  const online = getActiveFromListWithDistance(candidateIds, null, null);
  const notifiedIds = [];
  for (const d of online) {
    const result = notifyDriverDeliveryRequest(db, io, orderId, order, d.driverId, store);
    if (result.notified) notifiedIds.push(d.driverId);
  }
  return notifiedIds;
}

module.exports = {
  notifyDriverDeliveryRequest,
  notifyAllOnlineDrivers,
  offerNextSequentialDriver,
  countPendingDriverRequests,
  getStoreForOrder,
  getStoreLatLong,
  fcmPayloadForDriverRequest,
  parseLatLongFromGoogleMapsUrl,
};
