const { ensureOrderStatusTimestampColumns } = require('./orderStatusTimestamps');

function ensureStoreStatsPrereqs(db) {
  ensureOrderStatusTimestampColumns(db);
}

/**
 * Aggregate per-store metrics from delivered / in-progress orders.
 * Used for admin store list sorting and store profile stats.
 */
function loadStoreOrderStatsMap(db, dateFrom, dateTo) {
  ensureStoreStatsPrereqs(db);
  const params = [];
  const dateParts = ["storeId IS NOT NULL AND storeId != ''"];
  if (dateFrom) {
    dateParts.push('date(createdAt) >= date(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    dateParts.push('date(createdAt) <= date(?)');
    params.push(dateTo);
  }
  const where = dateParts.join(' AND ');
  const rows = db
    .prepare(
      `
      SELECT
        storeId,
        COUNT(*) AS orderCount,
        ROUND(COALESCE(SUM(
          COALESCE(totalAmount, 0) + COALESCE(deliveryFee, 0) + COALESCE(serviceFee, 0) + COALESCE(feesTax, 0)
        ), 0), 2) AS ordersGrandTotalJod,
        ROUND(AVG(
          CASE WHEN preparingAt IS NOT NULL AND onTheWayAt IS NOT NULL
            THEN (julianday(onTheWayAt) - julianday(preparingAt)) * 24 * 60
          END
        ), 1) AS avgPreparationTimeMinutes,
        ROUND(AVG(
          CASE WHEN onTheWayAt IS NOT NULL AND deliveredAt IS NOT NULL
            THEN (julianday(deliveredAt) - julianday(onTheWayAt)) * 24 * 60
          END
        ), 1) AS avgDeliveryTimeMinutes,
        ROUND(AVG(
          CASE WHEN createdAt IS NOT NULL AND preparingAt IS NOT NULL
            THEN (julianday(preparingAt) - julianday(createdAt)) * 24 * 60
          END
        ), 1) AS avgResponseTimeMinutes
      FROM orders
      WHERE ${where}
      GROUP BY storeId
    `,
    )
    .all(...params);
  const map = {};
  for (const r of rows) {
    map[String(r.storeId)] = {
      orderCount: Number(r.orderCount) || 0,
      ordersGrandTotalJod: Number(r.ordersGrandTotalJod) || 0,
      avgPreparationTimeMinutes: r.avgPreparationTimeMinutes != null ? Number(r.avgPreparationTimeMinutes) : null,
      avgDeliveryTimeMinutes: r.avgDeliveryTimeMinutes != null ? Number(r.avgDeliveryTimeMinutes) : null,
      avgResponseTimeMinutes: r.avgResponseTimeMinutes != null ? Number(r.avgResponseTimeMinutes) : null,
    };
  }
  return map;
}

function sortStoresByMetric(list, statsMap, sortBy, sortDir) {
  const dir = String(sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const key = String(sortBy || '').trim().toLowerCase();
  const metricKey =
    key === 'ordervalue' || key === 'orders_value' || key === 'value'
      ? 'ordersGrandTotalJod'
      : key === 'avgpreptime' || key === 'preparation' || key === 'prep'
        ? 'avgPreparationTimeMinutes'
        : key === 'avgresponse' || key === 'response'
          ? 'avgResponseTimeMinutes'
          : key === 'avgdelivery' || key === 'delivery'
            ? 'avgDeliveryTimeMinutes'
            : 'orderCount';
  return [...list].sort((a, b) => {
    const sa = statsMap[String(a.id)] || {};
    const sb = statsMap[String(b.id)] || {};
    const va = sa[metricKey] != null ? sa[metricKey] : 0;
    const vb = sb[metricKey] != null ? sb[metricKey] : 0;
    if (va !== vb) return (va - vb) * dir;
    const na = String(a.name ?? a.nameEn ?? a.id ?? '');
    const nb = String(b.name ?? b.nameEn ?? b.id ?? '');
    return na.localeCompare(nb, undefined, { sensitivity: 'base' });
  });
}

function buildStoreProfileStats(db, storeId, dateFrom, dateTo) {
  ensureStoreStatsPrereqs(db);
  const params = [String(storeId)];
  const dateParts = ['storeId = ?'];
  if (dateFrom) {
    dateParts.push('date(createdAt) >= date(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    dateParts.push('date(createdAt) <= date(?)');
    params.push(dateTo);
  }
  const where = dateParts.join(' AND ');
  const summary =
    db
      .prepare(
        `
      SELECT
        COUNT(*) AS orderCount,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS deliveredCount,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelledCount,
        ROUND(COALESCE(SUM(COALESCE(totalAmount, 0)), 0), 2) AS itemsSubtotalSumJod,
        ROUND(COALESCE(SUM(
          COALESCE(totalAmount, 0) + COALESCE(deliveryFee, 0) + COALESCE(serviceFee, 0) + COALESCE(feesTax, 0)
        ), 0), 2) AS ordersGrandTotalJod,
        ROUND(AVG(
          CASE WHEN preparingAt IS NOT NULL AND onTheWayAt IS NOT NULL
            THEN (julianday(onTheWayAt) - julianday(preparingAt)) * 24 * 60
          END
        ), 1) AS avgPreparationTimeMinutes,
        ROUND(AVG(
          CASE WHEN onTheWayAt IS NOT NULL AND deliveredAt IS NOT NULL
            THEN (julianday(deliveredAt) - julianday(onTheWayAt)) * 24 * 60
          END
        ), 1) AS avgDeliveryTimeMinutes,
        ROUND(AVG(
          CASE WHEN createdAt IS NOT NULL AND preparingAt IS NOT NULL
            THEN (julianday(preparingAt) - julianday(createdAt)) * 24 * 60
          END
        ), 1) AS avgResponseTimeMinutes
      FROM orders
      WHERE ${where}
    `,
      )
      .get(...params) || {};

  const byStatus = db
    .prepare(
      `
      SELECT status, COUNT(*) AS c
      FROM orders
      WHERE ${where}
      GROUP BY status
      ORDER BY c DESC
    `,
    )
    .all(...params);

  const recent = db
    .prepare(`SELECT id, status, totalAmount, deliveryFee, serviceFee, feesTax, paymentType, createdAt, driverName FROM orders WHERE ${where} ORDER BY createdAt DESC, id DESC LIMIT 50`)
    .all(...params);

  const statusTimingRow =
    db
      .prepare(
        `
      SELECT
        ROUND(AVG(
          CASE WHEN createdAt IS NOT NULL AND preparingAt IS NOT NULL
            THEN (julianday(preparingAt) - julianday(COALESCE(waitingConfirmationAt, createdAt))) * 24 * 60
          END
        ), 1) AS waitingConfirmationMinutes,
        ROUND(AVG(
          CASE WHEN preparingAt IS NOT NULL AND onTheWayAt IS NOT NULL
            THEN (julianday(onTheWayAt) - julianday(preparingAt)) * 24 * 60
          END
        ), 1) AS preparingMinutes,
        ROUND(AVG(
          CASE WHEN onTheWayAt IS NOT NULL AND deliveredAt IS NOT NULL
            THEN (julianday(deliveredAt) - julianday(onTheWayAt)) * 24 * 60
          END
        ), 1) AS onTheWayMinutes
      FROM orders
      WHERE ${where}
    `,
      )
      .get(...params) || {};

  const statusAvgMinutes = [
    {
      status: 'Waiting confirmation',
      avgMinutes:
        statusTimingRow.waitingConfirmationMinutes != null
          ? Number(statusTimingRow.waitingConfirmationMinutes)
          : null,
    },
    {
      status: 'Preparing',
      avgMinutes: statusTimingRow.preparingMinutes != null ? Number(statusTimingRow.preparingMinutes) : null,
    },
    {
      status: 'On the way',
      avgMinutes: statusTimingRow.onTheWayMinutes != null ? Number(statusTimingRow.onTheWayMinutes) : null,
    },
  ];

  return {
    summary: {
      orderCount: Number(summary.orderCount) || 0,
      deliveredCount: Number(summary.deliveredCount) || 0,
      cancelledCount: Number(summary.cancelledCount) || 0,
      itemsSubtotalSumJod: Number(summary.itemsSubtotalSumJod) || 0,
      ordersGrandTotalJod: Number(summary.ordersGrandTotalJod) || 0,
      avgPreparationTimeMinutes: summary.avgPreparationTimeMinutes != null ? Number(summary.avgPreparationTimeMinutes) : null,
      avgDeliveryTimeMinutes: summary.avgDeliveryTimeMinutes != null ? Number(summary.avgDeliveryTimeMinutes) : null,
      avgResponseTimeMinutes: summary.avgResponseTimeMinutes != null ? Number(summary.avgResponseTimeMinutes) : null,
    },
    byStatus,
    recentOrders: recent,
    statusAvgMinutes,
  };
}

module.exports = {
  loadStoreOrderStatsMap,
  sortStoresByMetric,
  buildStoreProfileStats,
};
