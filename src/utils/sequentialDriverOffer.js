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
    console.log(`[driver-notify] Skip driver ${driverId} for order ${orderId}: already_pending`);
    return { notified: false, reason: 'already_pending' };
  }
  if (existing?.status === 'rejected' || existing?.status === 'accepted') {
    console.log(`[driver-notify] Skip driver ${driverId} for order ${orderId}: already_${existing.status}`);
    return { notified: false, reason: `already_${existing.status}` };
  }
  db.prepare('INSERT INTO driver_requests (orderId, driverId, status) VALUES (?, ?, ?)').run(orderId, driverId, 'pending');

  const storeName = store?.nameEn || store?.name || store?.nameAr || 'store';
  console.log(`[driver-notify] Sending FCM to driver ${driverId} for order ${orderId} (store: ${storeName})`);

  fcm
    .sendToDriver(
      db,
      driverId,
      'New delivery request',
      `Order #${orderId} from ${storeName}. Open the app to accept or reject.`,
      fcmPayloadForDriverRequest(order, store, orderId)
    )
    .then((result) => {
      console.log(`[driver-notify] FCM result for driver ${driverId}, order ${orderId}:`, JSON.stringify(result));
    })
    .catch((err) => {
      console.error(`[driver-notify] FCM FAILED for driver ${driverId}, order ${orderId}:`, err?.message || err);
    });

  const socketSent = emitDriverDeliveryRequest(io, driverId, {
    orderId,
    status: 'Preparing',
    storeId: order.storeId,
    storeName,
    type: 'driver_request',
  });
  console.log(`[driver-notify] Socket emit for driver ${driverId}, order ${orderId}: ${socketSent ? 'sent' : 'driver not connected'}`);

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
  console.log(`[driver-notify] Broadcasting order ${orderId} to ${online.length} online drivers (${candidateIds.length} total non-blocked)`);
  const notifiedIds = [];
  for (const d of online) {
    const result = notifyDriverDeliveryRequest(db, io, orderId, order, d.driverId, store);
    if (result.notified) notifiedIds.push(d.driverId);
  }
  console.log(`[driver-notify] Notified ${notifiedIds.length} drivers for order ${orderId}: [${notifiedIds.join(', ')}]`);
  return notifiedIds;
}

/**
 * FCM payload for an Arheb Box driver request.
 */
function fcmPayloadForArhebBoxRequest(requestRow, requestId) {
  let pickupAddr = '';
  let dropoffAddr = '';
  try { pickupAddr = JSON.parse(requestRow.pickup || '{}').address || ''; } catch (e) { /* ignore */ }
  try { dropoffAddr = JSON.parse(requestRow.dropoff || '{}').address || ''; } catch (e) { /* ignore */ }
  return {
    requestId: String(requestId),
    status: requestRow.status || 'confirmed',
    type: 'arheb_box_delivery_request',
    screen: 'arheb_box_details',
    deepLink: `arheb://arheb-box/${requestId}`,
    pickupAddress: pickupAddr,
    dropoffAddress: dropoffAddr,
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
  };
}

/**
 * Notify a single driver about an Arheb Box request. Uses driver_requests table with
 * orderId = -requestId (negative) to distinguish from store orders.
 */
function notifyDriverArhebBoxRequest(db, io, requestId, requestRow, driverId) {
  const pseudoOrderId = -requestId;
  const existing = db.prepare('SELECT status FROM driver_requests WHERE orderId = ? AND driverId = ?').get(pseudoOrderId, driverId);
  if (existing?.status === 'pending') return { notified: false, reason: 'already_pending' };
  if (existing?.status === 'rejected' || existing?.status === 'accepted') return { notified: false, reason: `already_${existing.status}` };

  db.prepare('INSERT INTO driver_requests (orderId, driverId, status) VALUES (?, ?, ?)').run(pseudoOrderId, driverId, 'pending');

  const payload = fcmPayloadForArhebBoxRequest(requestRow, requestId);
  fcm.sendToDriver(db, driverId, 'New Arheb Box delivery request', `Box request #${requestId}. Open the app to accept or reject.`, payload)
    .then((r) => console.log(`[driver-notify] FCM arheb-box result driver ${driverId}, req ${requestId}:`, JSON.stringify(r)))
    .catch((err) => console.error(`[driver-notify] FCM FAILED arheb-box driver ${driverId}, req ${requestId}:`, err?.message || err));

  const socketSent = emitDriverDeliveryRequest(io, driverId, {
    requestId,
    status: requestRow.status || 'confirmed',
    type: 'arheb_box_delivery_request',
  });
  console.log(`[driver-notify] Socket emit arheb-box driver ${driverId}, req ${requestId}: ${socketSent ? 'sent' : 'not connected'}`);
  return { notified: true };
}

/** Radius steps (km) from sender pickup; then a final wave to all online drivers not yet notified. */
const ARHEB_BOX_OFFER_RADIUS_STEPS_KM = [0.5, 1.5, 4];
const ARHEB_BOX_OFFER_EXPAND_MS = 45_000;

/** requestId -> Timeout */
const arhebBoxOfferExpansionTimers = new Map();

function clearArhebBoxOfferExpansion(requestId) {
  if (requestId == null) return;
  const t = arhebBoxOfferExpansionTimers.get(requestId);
  if (t) clearTimeout(t);
  arhebBoxOfferExpansionTimers.delete(requestId);
}

function parsePickupLatLongFromArhebRow(requestRow) {
  try {
    const p = JSON.parse(requestRow.pickup || '{}');
    const lat = Number(p.latitude ?? p.lat);
    const lon = Number(p.longitude ?? p.lng ?? p.long);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  } catch (_) {}
  return null;
}

function isArhebBoxStillSeekingDriver(db, requestId) {
  try {
    const row = db.prepare('SELECT driverId, status FROM arheb_box_requests WHERE id = ?').get(requestId);
    if (!row || row.driverId != null) return false;
    const s = String(row.status || '').toLowerCase();
    if (s === 'delivered' || s === 'cancelled') return false;
    return true;
  } catch (e) {
    return false;
  }
}

function countPendingArhebBoxDriverRequests(db, requestId) {
  const pseudoOrderId = -requestId;
  try {
    return (
      db.prepare('SELECT COUNT(*) AS n FROM driver_requests WHERE orderId = ? AND status = ?').get(pseudoOrderId, 'pending')?.n ?? 0
    );
  } catch (e) {
    return 0;
  }
}

/**
 * One pending Arheb Box invite at a time (nearest online driver from pickup), same idea as store orders.
 * @returns {null | { driverId: number, distanceKm?: number }}
 */
function offerNextSequentialArhebBoxDriver(db, io, requestId, requestRow, ctx) {
  const { getActiveFromListWithDistance } = ctx;
  if (!requestRow || requestRow.driverId != null) return null;
  if (!isArhebBoxStillSeekingDriver(db, requestId)) return null;
  if (countPendingArhebBoxDriverRequests(db, requestId) > 0) return null;

  let drivers = [];
  try {
    drivers = db.prepare('SELECT id FROM drivers WHERE isBlocked = 0').all();
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) throw e;
  }
  const candidateIds = drivers.map((d) => d.id);
  const pickup = parsePickupLatLongFromArhebRow(requestRow);
  const withDistance = pickup
    ? getActiveFromListWithDistance(candidateIds, pickup.lat, pickup.lon)
    : getActiveFromListWithDistance(candidateIds, null, null);

  const pseudoOrderId = -requestId;
  let rejectedRows = [];
  try {
    rejectedRows = db.prepare('SELECT driverId FROM driver_requests WHERE orderId = ? AND status = ?').all(pseudoOrderId, 'rejected');
  } catch (e) {
    rejectedRows = [];
  }
  const rejected = new Set(rejectedRows.map((x) => x.driverId));

  const freshRow = () => db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId) || requestRow;

  for (const d of withDistance) {
    if (rejected.has(d.driverId)) continue;
    const n = notifyDriverArhebBoxRequest(db, io, requestId, freshRow(), d.driverId);
    if (n.notified) {
      return { driverId: d.driverId, distanceKm: d.distanceKm };
    }
  }
  return null;
}

/**
 * Notify online drivers within maxKm of pickup. maxKm >= 1e6 means no distance cap (still sorted by distance when pickup exists).
 */
function notifyArhebBoxDriversInRadius(db, io, requestId, requestRow, maxKm, getActiveFromListWithDistance) {
  let drivers = [];
  try {
    drivers = db.prepare('SELECT id FROM drivers WHERE isBlocked = 0').all();
  } catch (e) {
    return [];
  }
  const candidateIds = drivers.map((d) => d.id);
  const pickup = parsePickupLatLongFromArhebRow(requestRow);
  const withDist = pickup
    ? getActiveFromListWithDistance(candidateIds, pickup.lat, pickup.lon)
    : getActiveFromListWithDistance(candidateIds, null, null);

  if (pickup) {
    console.log(
      `[driver-notify] arheb-box #${requestId} radius ${maxKm >= 1e6 ? 'ALL' : `${maxKm}km`} from pickup (${pickup.lat.toFixed(5)},${pickup.lon.toFixed(5)}): ${withDist.length} online drivers (sorted by distance)`,
    );
  }

  const notifiedIds = [];
  const unlimited = maxKm >= 1e6;
  for (const d of withDist) {
    if (!unlimited && pickup && d.distanceKm != null && d.distanceKm > maxKm) continue;
    const result = notifyDriverArhebBoxRequest(db, io, requestId, requestRow, d.driverId);
    if (result.notified) notifiedIds.push(d.driverId);
  }
  return notifiedIds;
}

/**
 * Notify drivers near pickup (0.5 km first), then widen radius every ARHEB_BOX_OFFER_EXPAND_MS until all online are offered.
 */
function notifyAllOnlineDriversArhebBox(db, io, requestId, requestRow, ctx) {
  const { getActiveFromListWithDistance } = ctx;
  clearArhebBoxOfferExpansion(requestId);

  const pickup = parsePickupLatLongFromArhebRow(requestRow);
  if (!pickup) {
    let drivers = [];
    try {
      drivers = db.prepare('SELECT id FROM drivers WHERE isBlocked = 0').all();
    } catch (e) {
      return [];
    }
    const candidateIds = drivers.map((d) => d.id);
    const online = getActiveFromListWithDistance(candidateIds, null, null);
    console.log(
      `[driver-notify] arheb-box #${requestId}: no pickup GPS in row (check pickup JSON has latitude/longitude) — notifying ${online.length} online drivers`,
    );
    const notifiedIds = [];
    for (const d of online) {
      const result = notifyDriverArhebBoxRequest(db, io, requestId, requestRow, d.driverId);
      if (result.notified) notifiedIds.push(d.driverId);
    }
    return notifiedIds;
  }

  const freshRow = () => db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId) || requestRow;

  let step = 0;
  const firstNotified = notifyArhebBoxDriversInRadius(
    db,
    io,
    requestId,
    freshRow(),
    ARHEB_BOX_OFFER_RADIUS_STEPS_KM[0],
    getActiveFromListWithDistance,
  );
  console.log(
    `[driver-notify] arheb-box #${requestId} wave ${ARHEB_BOX_OFFER_RADIUS_STEPS_KM[0]}km → ${firstNotified.length} drivers`,
  );

  function scheduleNext() {
    step += 1;
    if (step >= ARHEB_BOX_OFFER_RADIUS_STEPS_KM.length) {
      const tid = setTimeout(() => {
        arhebBoxOfferExpansionTimers.delete(requestId);
        if (!isArhebBoxStillSeekingDriver(db, requestId)) return;
        const row = freshRow();
        const rest = notifyArhebBoxDriversInRadius(db, io, requestId, row, 1e9, getActiveFromListWithDistance);
        console.log(`[driver-notify] arheb-box #${requestId} final wave (all online) → ${rest.length} newly notified`);
      }, ARHEB_BOX_OFFER_EXPAND_MS);
      arhebBoxOfferExpansionTimers.set(requestId, tid);
      return;
    }
    const maxKm = ARHEB_BOX_OFFER_RADIUS_STEPS_KM[step];
    const tid = setTimeout(() => {
      arhebBoxOfferExpansionTimers.delete(requestId);
      if (!isArhebBoxStillSeekingDriver(db, requestId)) return;
      const row = freshRow();
      const n = notifyArhebBoxDriversInRadius(db, io, requestId, row, maxKm, getActiveFromListWithDistance);
      console.log(`[driver-notify] arheb-box #${requestId} wave ${maxKm}km → ${n.length} newly notified`);
      scheduleNext();
    }, ARHEB_BOX_OFFER_EXPAND_MS);
    arhebBoxOfferExpansionTimers.set(requestId, tid);
  }

  scheduleNext();
  return firstNotified;
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
  notifyDriverArhebBoxRequest,
  notifyAllOnlineDriversArhebBox,
  offerNextSequentialArhebBoxDriver,
  clearArhebBoxOfferExpansion,
  fcmPayloadForArhebBoxRequest,
  parsePickupLatLongFromArhebRow,
};
