/**
 * Sequential “nearest online driver” chain for store orders (Preparing, no driver yet).
 * One pending invite at a time; on reject, offer the next nearest driver connected to /driver-presence.
 */

const fcm = require('../fcm');
const { emitDriverDeliveryRequest, haversineKm } = require('../driverPresence');

function arhebDebugLog(tag, payload) {
  const v = process.env.ARHEB_DEBUG;
  if (v !== '1' && String(v).toLowerCase() !== 'true') return;
  console.log('[arheb-debug]', tag, JSON.stringify({ ...payload, t: new Date().toISOString() }));
}

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
 * Sort driver candidates nearest-to-store first. Uses live /driver-presence when available,
 * otherwise falls back to last-known coordinates on the drivers row.
 */
function sortDriverCandidatesByStoreDistance(db, candidateIds, storeLat, storeLong, withDistanceOnline = []) {
  const onlineById = new Map(withDistanceOnline.map((d) => [Number(d.driverId), d]));
  const rows = [];
  let findDriverCoords;
  try {
    findDriverCoords = db.prepare('SELECT latitude, longitude FROM drivers WHERE id = ?');
  } catch (e) {
    findDriverCoords = null;
  }
  for (const id of candidateIds) {
    const driverId = Number(id);
    if (!Number.isFinite(driverId)) continue;
    const online = onlineById.get(driverId);
    if (online) {
      rows.push(online);
      continue;
    }
    let lat;
    let lon;
    if (findDriverCoords) {
      try {
        const row = findDriverCoords.get(driverId);
        lat = Number(row?.latitude);
        lon = Number(row?.longitude);
      } catch (e) {
        lat = NaN;
        lon = NaN;
      }
    }
    let distanceKm;
    if (storeLat != null && storeLong != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      distanceKm = haversineKm(lat, lon, storeLat, storeLong);
    }
    rows.push({ driverId, distanceKm });
  }
  if (storeLat != null && storeLong != null) {
    rows.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  return rows;
}

/** One pending invite at a time; if no accept/reject in this window, offer passes to the next nearest driver. */
const SEQUENTIAL_DRIVER_OFFER_TIMEOUT_MS = 20_000;

/** orderId (positive, store order) -> Timeout */
const storeOrderOfferTimers = new Map();

function clearStoreOrderOfferTimeout(orderId) {
  if (orderId == null) return;
  const t = storeOrderOfferTimers.get(orderId);
  if (t) clearTimeout(t);
  storeOrderOfferTimers.delete(orderId);
}

function rejectAllPendingDriverRequestsForStoreOrder(db, orderId) {
  try {
    db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND status = ?').run('rejected', orderId, 'pending');
  } catch (e) {
    /* ignore */
  }
}

function scheduleStoreOrderOfferTimeout(db, io, orderId, offeredDriverId, ctx) {
  clearStoreOrderOfferTimeout(orderId);
  const tid = setTimeout(() => {
    storeOrderOfferTimers.delete(orderId);
    try {
      const row = db.prepare('SELECT status FROM driver_requests WHERE orderId = ? AND driverId = ?').get(orderId, offeredDriverId);
      if (!row || row.status !== 'pending') return;
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order || order.driverId != null) return;
      const st = String(order.status || '').toLowerCase();
      if (!st.includes('prepar')) return;
      db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId = ?').run('rejected', orderId, offeredDriverId);
      const next = offerNextSequentialDriver(db, io, orderId, order, ctx);
      if (next && io) {
        try {
          const { broadcastDriverOrdersUpdated } = require('../driverPresence');
          broadcastDriverOrdersUpdated(io, { type: 'new_request', orderId });
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      console.error('[driver-offer] store order offer timeout:', e?.message || e);
    }
  }, SEQUENTIAL_DRIVER_OFFER_TIMEOUT_MS);
  storeOrderOfferTimers.set(orderId, tid);
}

/** Arheb Box sequential (pseudo order id negative) */
const arhebBoxSequentialOfferTimers = new Map();

function clearArhebBoxSequentialOfferTimeout(requestId) {
  if (requestId == null) return;
  const t = arhebBoxSequentialOfferTimers.get(requestId);
  if (t) clearTimeout(t);
  arhebBoxSequentialOfferTimers.delete(requestId);
}

function scheduleArhebBoxSequentialOfferTimeout(db, io, requestId, offeredDriverId, ctx) {
  clearArhebBoxSequentialOfferTimeout(requestId);
  const pseudoOrderId = -requestId;
  const tid = setTimeout(() => {
    arhebBoxSequentialOfferTimers.delete(requestId);
    try {
      const row = db.prepare('SELECT status FROM driver_requests WHERE orderId = ? AND driverId = ?').get(pseudoOrderId, offeredDriverId);
      if (!row || row.status !== 'pending') return;
      let boxRow;
      try {
        boxRow = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
      } catch (e) {
        boxRow = null;
      }
      if (!boxRow || boxRow.driverId != null) return;
      if (!isArhebBoxStillSeekingDriver(db, requestId)) return;
      db.prepare('UPDATE driver_requests SET status = ? WHERE orderId = ? AND driverId = ?').run('rejected', pseudoOrderId, offeredDriverId);
      const fresh = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId) || boxRow;
      const next = offerNextSequentialArhebBoxDriver(db, io, requestId, fresh, ctx);
      if (next && io) {
        try {
          const { broadcastDriverOrdersUpdated } = require('../driverPresence');
          broadcastDriverOrdersUpdated(io, { type: 'arheb_box_new_request', requestId });
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      console.error('[driver-offer] arheb-box offer timeout:', e?.message || e);
    }
  }, SEQUENTIAL_DRIVER_OFFER_TIMEOUT_MS);
  arhebBoxSequentialOfferTimers.set(requestId, tid);
}

/**
 * Next nearest **online** (socket presence) driver who has not rejected this order yet.
 * @returns {null | { driverId: number, distanceKm?: number }}
 */
function offerNextSequentialDriver(db, io, orderId, order, ctx) {
  const { loadStores, getActiveFromListWithDistance, parseLatLongFromGoogleMapsUrl: parseFn } = ctx;
  const parseLat = parseFn || parseLatLongFromGoogleMapsUrl;
  if (!order || order.driverId != null) return null;
  if (countPendingDriverRequests(db, orderId) > 0) return null;

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

  let toTry = withDistance.length
    ? withDistance
    : sortDriverCandidatesByStoreDistance(db, candidateIds, storeLat, storeLong, withDistance);
  if (!withDistance.length && candidateIds.length) {
    console.log(
      `[driver-notify] order #${orderId}: no drivers on /driver-presence — falling back to nearest-by-DB-location FCM (one at a time)`,
    );
  }

  for (const d of toTry) {
    if (rejected.has(d.driverId)) continue;
    const n = notifyDriverDeliveryRequest(db, io, orderId, order, d.driverId, store);
    if (n.notified) {
      scheduleStoreOrderOfferTimeout(db, io, orderId, d.driverId, ctx);
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
  const idStr = String(requestId);
  /** Same `type` / keys as store `fcmPayloadForDriverRequest` so the driver app handles the push like order details. */
  return {
    orderId: idStr,
    requestId: idStr,
    status: String(requestRow.status || 'confirmed'),
    storeId: '',
    storeName: 'Arheb Box',
    storeMapsUrl: '',
    orderType: 'arheb_box',
    type: 'driver_request',
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
function notifyDriverArhebBoxRequest(db, io, requestId, requestRow, driverId, options = {}) {
  const { resendFcmIfPending = false } = options;
  const pseudoOrderId = -requestId;
  const existing = db.prepare('SELECT status FROM driver_requests WHERE orderId = ? AND driverId = ?').get(pseudoOrderId, driverId);
  if (existing?.status === 'pending') {
    if (resendFcmIfPending) {
      const payload = fcmPayloadForArhebBoxRequest(requestRow, requestId);
      arhebDebugLog('arheb_box_fcm_resend_pending', { requestId, driverId });
      fcm
        .sendToDriver(
          db,
          driverId,
          'New delivery request',
          `Arheb Box #${requestId} — open the app to accept or reject.`,
          payload,
        )
        .then((r) => {
          arhebDebugLog('arheb_box_fcm_send_result', { requestId, driverId, messageId: r || null, ok: !!r, resent: true });
          console.log(`[driver-notify] FCM arheb-box (resent) driver ${driverId}, req ${requestId}:`, JSON.stringify(r));
        })
        .catch((err) => {
          arhebDebugLog('arheb_box_fcm_send_error', { requestId, driverId, error: err?.message || String(err), resent: true });
          console.error(`[driver-notify] FCM FAILED arheb-box (resent) driver ${driverId}, req ${requestId}:`, err?.message || err);
        });
      const socketSent = emitDriverDeliveryRequest(io, driverId, {
        orderId: requestId,
        requestId,
        status: requestRow.status || 'confirmed',
        storeName: 'Arheb Box',
        type: 'driver_request',
        orderType: 'arheb_box',
      });
      console.log(`[driver-notify] Socket emit arheb-box (resent) driver ${driverId}, req ${requestId}: ${socketSent ? 'sent' : 'not connected'}`);
      return { notified: true, resent: true };
    }
    arhebDebugLog('arheb_box_skip_driver', { requestId, driverId, reason: 'already_pending' });
    return { notified: false, reason: 'already_pending' };
  }
  if (existing?.status === 'rejected' || existing?.status === 'accepted') {
    arhebDebugLog('arheb_box_skip_driver', { requestId, driverId, reason: `already_${existing.status}` });
    return { notified: false, reason: `already_${existing.status}` };
  }

  db.prepare('INSERT INTO driver_requests (orderId, driverId, status) VALUES (?, ?, ?)').run(pseudoOrderId, driverId, 'pending');

  const payload = fcmPayloadForArhebBoxRequest(requestRow, requestId);
  arhebDebugLog('arheb_box_fcm_send_start', { requestId, driverId, payloadType: payload.type });
  fcm.sendToDriver(
    db,
    driverId,
    'New delivery request',
    `Arheb Box #${requestId} — open the app to accept or reject.`,
    payload,
  )
    .then((r) => {
      arhebDebugLog('arheb_box_fcm_send_result', { requestId, driverId, messageId: r || null, ok: !!r });
      console.log(`[driver-notify] FCM arheb-box result driver ${driverId}, req ${requestId}:`, JSON.stringify(r));
    })
    .catch((err) => {
      arhebDebugLog('arheb_box_fcm_send_error', { requestId, driverId, error: err?.message || String(err) });
      console.error(`[driver-notify] FCM FAILED arheb-box driver ${driverId}, req ${requestId}:`, err?.message || err);
    });

  const socketSent = emitDriverDeliveryRequest(io, driverId, {
    orderId: requestId,
    requestId,
    status: requestRow.status || 'confirmed',
    storeName: 'Arheb Box',
    type: 'driver_request',
    orderType: 'arheb_box',
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
  clearArhebBoxSequentialOfferTimeout(requestId);
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

  let toTry = withDistance;
  if (pickup && withDistance.length) {
    const within4 = withDistance.filter((d) => d.distanceKm == null || d.distanceKm <= 4);
    if (within4.length > 0) toTry = within4;
  }
  if (!toTry.length && candidateIds.length) {
    toTry = candidateIds.map((driverId) => ({ driverId, distanceKm: undefined }));
    console.log(
      `[driver-notify] arheb-box #${requestId}: no drivers on /driver-presence — falling back to FCM for ${toTry.length} candidate driver(s)`,
    );
  }
  arhebDebugLog('arheb_box_offer_next', {
    requestId,
    onlineCandidates: withDistance.length,
    tryCount: toTry.length,
    rejectedCount: rejected.size,
    pendingOther: countPendingArhebBoxDriverRequests(db, requestId),
  });

  for (const d of toTry) {
    if (rejected.has(d.driverId)) continue;
    const n = notifyDriverArhebBoxRequest(db, io, requestId, freshRow(), d.driverId);
    if (n.notified) {
      scheduleArhebBoxSequentialOfferTimeout(db, io, requestId, d.driverId, ctx);
      return { driverId: d.driverId, distanceKm: d.distanceKm };
    }
  }
  return null;
}

/**
 * Notify online drivers within maxKm of pickup. maxKm >= 1e6 means no distance cap (still sorted by distance when pickup exists).
 */
function notifyArhebBoxDriversInRadius(db, io, requestId, requestRow, maxKm, getActiveFromListWithDistance, waveOptions = {}) {
  const { resendFcmIfPending = false } = waveOptions;
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
  let toIterate = [];
  if (!pickup || unlimited) {
    toIterate = withDist;
  } else {
    const inRadius = withDist.filter((d) => d.distanceKm == null || d.distanceKm <= maxKm);
    if (inRadius.length > 0) {
      toIterate = inRadius;
    } else if (withDist.length > 0) {
      toIterate = [withDist[0]];
      console.log(
        `[driver-notify] arheb-box #${requestId}: no online drivers within ${maxKm}km — notifying nearest online driver ${withDist[0].driverId}`,
      );
    }
  }

  for (const d of toIterate) {
    const result = notifyDriverArhebBoxRequest(db, io, requestId, requestRow, d.driverId, { resendFcmIfPending });
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
      const result = notifyDriverArhebBoxRequest(db, io, requestId, requestRow, d.driverId, { resendFcmIfPending: true });
      if (result.notified) notifiedIds.push(d.driverId);
    }
    return notifiedIds;
  }

  const freshRow = () => db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId) || requestRow;

  let step = 0;
  const waveOpts = { resendFcmIfPending: true };
  const firstNotified = notifyArhebBoxDriversInRadius(
    db,
    io,
    requestId,
    freshRow(),
    ARHEB_BOX_OFFER_RADIUS_STEPS_KM[0],
    getActiveFromListWithDistance,
    waveOpts,
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
        const rest = notifyArhebBoxDriversInRadius(db, io, requestId, row, 1e9, getActiveFromListWithDistance, waveOpts);
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
      const n = notifyArhebBoxDriversInRadius(db, io, requestId, row, maxKm, getActiveFromListWithDistance, waveOpts);
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
  clearStoreOrderOfferTimeout,
  rejectAllPendingDriverRequestsForStoreOrder,
  clearArhebBoxSequentialOfferTimeout,
  SEQUENTIAL_DRIVER_OFFER_TIMEOUT_MS,
  getStoreForOrder,
  getStoreLatLong,
  sortDriverCandidatesByStoreDistance,
  fcmPayloadForDriverRequest,
  parseLatLongFromGoogleMapsUrl,
  notifyDriverArhebBoxRequest,
  notifyAllOnlineDriversArhebBox,
  offerNextSequentialArhebBoxDriver,
  clearArhebBoxOfferExpansion,
  fcmPayloadForArhebBoxRequest,
  parsePickupLatLongFromArhebRow,
};
