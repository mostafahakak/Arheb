/**
 * Auto-assign Preparing orders to online drivers:
 * - Greedy clusters by delivery distance (≤ maxChainKm between consecutive orders, sorted by id).
 * - A cluster may join an existing driver if any delivery in the cluster is within maxChainKm of any of that driver's active Preparing deliveries (same store).
 * - Otherwise each cluster takes the next nearest-to-store online driver (no per-driver order cap).
 */

const { haversineKm, broadcastDriverOrdersUpdated } = require('../driverPresence');
const { assignDriverToOrder } = require('./driverCommission');
const fcm = require('../fcm');
const { emitDriverDeliveryRequest } = require('../driverPresence');
const { getStoreLatLong, parseLatLongFromGoogleMapsUrl } = require('./sequentialDriverOffer');

const DEFAULT_MAX_CHAIN_KM = 1;

function getOrderDeliveryCoords(order) {
  const lat = Number(order.addressLat);
  const lng = Number(order.addressLong);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * @param {object[]} orders - Preparing, same store; will be sorted by id asc
 * @param {number} maxChainKm
 * @returns {object[][]} clusters (each non-empty)
 */
function clusterOrdersByDeliveryChain(orders, maxChainKm = DEFAULT_MAX_CHAIN_KM) {
  const sorted = [...orders].sort((a, b) => a.id - b.id);
  if (sorted.length === 0) return [];
  const clusters = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const o = sorted[i];
    const last = cur[cur.length - 1];
    const cLast = getOrderDeliveryCoords(last);
    const cNew = getOrderDeliveryCoords(o);
    let link = false;
    if (cLast && cNew) {
      link = haversineKm(cLast.lat, cLast.lng, cNew.lat, cNew.lng) <= maxChainKm;
    }
    if (link) cur.push(o);
    else {
      clusters.push(cur);
      cur = [o];
    }
  }
  clusters.push(cur);
  return clusters;
}

function emitOrderStatus(orderId, status) {
  try {
    const { emitOrderEvent } = require('../order');
    if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status });
  } catch (e) {
    /* ignore */
  }
}

/**
 * Find driver (nearest-to-store first) who already has Preparing deliveries for this store
 * and is within maxKm of at least one order in the cluster.
 */
function findExistingDriverForCluster(db, cluster, storeIdStr, onlineSorted, maxKm = DEFAULT_MAX_CHAIN_KM) {
  const clusterCoords = cluster.map(getOrderDeliveryCoords).filter(Boolean);
  if (clusterCoords.length === 0) return null;

  for (const d of onlineSorted) {
    const driverId = d.driverId;
    let existing;
    try {
      const activeStatuses = "('Preparing', 'In progress', 'Being prepared', 'Driver to pick', 'On the way')";
      if (storeIdStr == null) {
        existing = db
          .prepare(
            `SELECT addressLat, addressLong FROM orders
             WHERE driverId = ? AND status IN ${activeStatuses} AND storeId IS NULL`,
          )
          .all(driverId);
      } else {
        existing = db
          .prepare(
            `SELECT addressLat, addressLong FROM orders
             WHERE driverId = ? AND status IN ${activeStatuses} AND CAST(storeId AS TEXT) = ?`,
          )
          .all(driverId, storeIdStr);
      }
    } catch (e) {
      existing = [];
    }
    const exCoords = existing.map(getOrderDeliveryCoords).filter(Boolean);
    if (exCoords.length === 0) continue;

    let ok = true;
    for (const cc of clusterCoords) {
      const nearSome = exCoords.some((ec) => haversineKm(cc.lat, cc.lng, ec.lat, ec.lng) <= maxKm);
      if (!nearSome) {
        ok = false;
        break;
      }
    }
    if (ok) return driverId;
  }
  return null;
}

function notifyDriverAssigned(db, io, orderId, order, driverId, store) {
  const liveStatus = String(order?.status || '').trim() || 'Preparing';
  fcm
    .sendToDriver(
      db,
      driverId,
      'New delivery assigned',
      `Order #${orderId} from ${store?.nameEn || store?.name || store?.nameAr || 'store'} — assigned to you. Open the app for details.`,
      {
        orderId: String(orderId),
        status: liveStatus,
        storeId: String(order.storeId || ''),
        storeName: String(store?.nameEn || store?.name || store?.nameAr || ''),
        storeMapsUrl: String(store?.mapsUrl || ''),
        type: 'driver_request',
        screen: 'order_details',
        deepLink: `arheb://orders/${orderId}`,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
    )
    .catch(() => {});
  emitDriverDeliveryRequest(io, driverId, {
    orderId,
    status: liveStatus,
    storeId: order.storeId,
    storeName: store?.nameEn || store?.name || store?.nameAr || '',
    type: 'driver_assigned',
  });
}

/**
 * @returns {{ assigned: Array<{ orderId: number, driverId: number }>, skipped: number[], noDriver: number[] }}
 */
function runDeliveryClusterAutoAssign(db, io, storeId, ctx, options = {}) {
  const maxChainKm = options.maxChainKm ?? DEFAULT_MAX_CHAIN_KM;
  const { loadStores, getActiveFromListWithDistance } = ctx;
  const assigned = [];
  const noDriver = [];
  const storeIdStr = storeId == null || storeId === '' ? null : String(storeId);

  let drivers = [];
  try {
    drivers = db.prepare('SELECT id FROM drivers WHERE isBlocked = 0').all();
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) throw e;
  }
  const candidateIds = drivers.map((d) => d.id);
  const store = storeIdStr != null ? loadStores().find((s) => String(s.id) === storeIdStr) || null : null;
  const { storeLat, storeLong } = getStoreLatLong(store, parseLatLongFromGoogleMapsUrl);
  const onlineSorted = getActiveFromListWithDistance(candidateIds, storeLat, storeLong);

  let unassigned = [];
  try {
    if (storeIdStr == null) {
      unassigned = db
        .prepare(
          `SELECT * FROM orders
           WHERE status = 'Preparing' AND driverId IS NULL AND storeId IS NULL
           ORDER BY id ASC`,
        )
        .all();
    } else {
      unassigned = db
        .prepare(
          `SELECT * FROM orders
           WHERE status = 'Preparing' AND driverId IS NULL AND CAST(storeId AS TEXT) = ?
           ORDER BY id ASC`,
        )
        .all(storeIdStr);
    }
  } catch (e) {
    return { assigned: [], noDriver: [] };
  }

  if (unassigned.length === 0) return { assigned: [], noDriver: [] };

  for (const o of unassigned) {
    try {
      db.prepare('DELETE FROM driver_requests WHERE orderId = ?').run(o.id);
    } catch (e) {
      /* ignore */
    }
  }

  const now = new Date().toISOString();
  try {
    if (storeIdStr == null) {
      db.prepare(
        `UPDATE orders SET driverAssignmentStatus = 'searching', driverSearchStartedAt = COALESCE(driverSearchStartedAt, ?)
         WHERE status = 'Preparing' AND driverId IS NULL AND storeId IS NULL`,
      ).run(now);
    } else {
      db.prepare(
        `UPDATE orders SET driverAssignmentStatus = 'searching', driverSearchStartedAt = COALESCE(driverSearchStartedAt, ?)
         WHERE status = 'Preparing' AND driverId IS NULL AND CAST(storeId AS TEXT) = ?`,
      ).run(now, storeIdStr);
    }
  } catch (e) {
    /* columns may not exist on very old DB */
  }

  const clusters = clusterOrdersByDeliveryChain(unassigned, maxChainKm);
  const usedNewDrivers = new Set();

  const takeNextFreshDriver = () => {
    for (const d of onlineSorted) {
      if (!usedNewDrivers.has(d.driverId)) {
        usedNewDrivers.add(d.driverId);
        return d.driverId;
      }
    }
    return null;
  };

  const findDriverById = db.prepare('SELECT * FROM drivers WHERE id = ?');

  for (const cluster of clusters) {
    const pending = cluster.filter((o) => o.driverId == null);
    if (pending.length === 0) continue;

    let driverId = findExistingDriverForCluster(db, pending, storeIdStr, onlineSorted, maxChainKm);
    if (driverId == null) {
      driverId = takeNextFreshDriver();
    }
    if (driverId == null) {
      for (const o of pending) {
        noDriver.push(o.id);
        try {
          db.prepare(
            `UPDATE orders SET driverAssignmentStatus = 'no_driver_online' WHERE id = ?`,
          ).run(o.id);
        } catch (e) {
          /* ignore */
        }
      }
      continue;
    }

    const dr = findDriverById.get(driverId);
    const driverName = dr?.name || null;

    for (const o of pending) {
      assignDriverToOrder(db, o.id, driverId, driverName, 'In progress');
      try {
        db.prepare(`UPDATE orders SET driverAssignmentStatus = NULL WHERE id = ?`).run(o.id);
      } catch (e) {
        /* ignore */
      }
      const full = db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
      notifyDriverAssigned(db, io, o.id, full, driverId, store);
      emitOrderStatus(o.id, full?.status || 'In progress');
      if (full?.phoneNumber) {
        fcm
          .sendToUserByPhone(
            db,
            full.phoneNumber,
            'Driver assigned',
            `A driver has been assigned to Order #${o.id}.`,
            null,
            {
              orderId: String(o.id),
              status: String(full?.status || 'In progress'),
              type: 'order_tracking',
              screen: 'order_details',
              deepLink: `arheb://orders/${o.id}`,
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          )
          .catch(() => {});
      }
      if (io) {
        try {
          broadcastDriverOrdersUpdated(io, { type: 'order_accepted', orderId: o.id, driverId });
        } catch (e) {
          /* ignore */
        }
      }
      assigned.push({ orderId: o.id, driverId });
    }
  }

  return { assigned, noDriver };
}

function ensureOrderAssignmentColumns(db) {
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverAssignmentStatus TEXT`);
  } catch (e) {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN driverSearchStartedAt TEXT`);
  } catch (e) {
    /* exists */
  }
}

module.exports = {
  clusterOrdersByDeliveryChain,
  runDeliveryClusterAutoAssign,
  ensureOrderAssignmentColumns,
  getOrderDeliveryCoords,
  DEFAULT_MAX_CHAIN_KM,
  notifyDriverAssigned,
};
