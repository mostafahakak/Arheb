const { loadStoreOrderStatsMap } = require('./storeAdminStats');
const { ensureOrderStatusTimestampColumns } = require('./orderStatusTimestamps');

function buildDriverStatsOverview(db, dateFrom, dateTo) {
  ensureOrderStatusTimestampColumns(db);
  const params = [];
  const cond = ['driverId IS NOT NULL'];
  if (dateFrom) {
    cond.push('date(createdAt) >= date(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    cond.push('date(createdAt) <= date(?)');
    params.push(dateTo);
  }
  const where = cond.join(' AND ');
  const aggRows = db
    .prepare(
      `
      SELECT
        driverId,
        COUNT(*) AS orderCount,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS deliveredCount,
        ROUND(AVG(
          CASE WHEN onTheWayAt IS NOT NULL AND deliveredAt IS NOT NULL
            THEN (julianday(deliveredAt) - julianday(onTheWayAt)) * 24 * 60
          END
        ), 1) AS avgDeliveryTimeMinutes,
        MIN(date(createdAt)) AS firstOrderDate,
        MAX(date(createdAt)) AS lastOrderDate
      FROM orders
      WHERE ${where}
      GROUP BY driverId
    `,
    )
    .all(...params);
  const aggById = Object.fromEntries(aggRows.map((r) => [String(r.driverId), r]));

  let drivers = [];
  try {
    drivers = db
      .prepare(
        'SELECT id, name, mobile, email, rating, ratingCount, isBlocked, deleted, deletedAt, createdAt FROM drivers ORDER BY id',
      )
      .all();
  } catch (e) {
    if (!e.message || !e.message.includes('no such table')) throw e;
  }

  return drivers.map((d) => {
    const agg = aggById[String(d.id)] || {};
    const orderCount = Number(agg.orderCount) || 0;
    const first = agg.firstOrderDate;
    const last = agg.lastOrderDate;
    let daySpan = 1;
    if (first && last) {
      const a = new Date(`${first}T00:00:00Z`).getTime();
      const b = new Date(`${last}T00:00:00Z`).getTime();
      if (Number.isFinite(a) && Number.isFinite(b)) {
        daySpan = Math.max(1, Math.round((b - a) / 86400000) + 1);
      }
    }
    return {
      id: d.id,
      name: d.name,
      mobile: d.mobile,
      email: d.email ?? '',
      rating: d.rating != null ? Number(d.rating) : 5,
      ratingCount: d.ratingCount != null ? Number(d.ratingCount) : 0,
      isBlocked: Boolean(d.isBlocked),
      archived: Boolean(d.deleted),
      archivedAt: d.deletedAt ?? null,
      orderCount,
      deliveredCount: Number(agg.deliveredCount) || 0,
      avgDeliveryTimeMinutes:
        agg.avgDeliveryTimeMinutes != null ? Number(agg.avgDeliveryTimeMinutes) : null,
      avgOrdersPerDay: orderCount > 0 ? Math.round((orderCount / daySpan) * 10) / 10 : 0,
      firstOrderDate: first || null,
      lastOrderDate: last || null,
    };
  });
}

function buildAdminStatsOverview(db, storesList, dateFrom, dateTo) {
  const statsMap = loadStoreOrderStatsMap(db, dateFrom || null, dateTo || null);
  const stores = (storesList || []).map((s) => {
    const st = statsMap[String(s.id)] || {
      orderCount: 0,
      ordersGrandTotalJod: 0,
      avgPreparationTimeMinutes: null,
      avgDeliveryTimeMinutes: null,
      avgResponseTimeMinutes: null,
    };
    return {
      id: s.id,
      name: s.nameEn || s.name || s.nameAr || String(s.id),
      nameAr: s.nameAr ?? null,
      nameEn: s.nameEn ?? null,
      preparingTimeMinutes:
        s.preparingTimeMinutes != null && Number.isFinite(Number(s.preparingTimeMinutes))
          ? Number(s.preparingTimeMinutes)
          : null,
      ...st,
    };
  });
  const drivers = buildDriverStatsOverview(db, dateFrom || null, dateTo || null);
  return {
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    stores,
    drivers,
  };
}

function statsOverviewToExportRows(overview) {
  const storeRows = (overview.stores || []).map((s) => ({
    sheet: 'Stores',
    id: s.id,
    name: s.name,
    orderCount: s.orderCount,
    ordersGrandTotalJod: s.ordersGrandTotalJod,
    avgResponseTimeMinutes: s.avgResponseTimeMinutes ?? '',
    avgPreparationTimeMinutes: s.avgPreparationTimeMinutes ?? '',
    customPreparingTimeMinutes: s.preparingTimeMinutes ?? '',
    avgDeliveryTimeMinutes: s.avgDeliveryTimeMinutes ?? '',
  }));
  const driverRows = (overview.drivers || []).map((d) => ({
    sheet: 'Drivers',
    id: d.id,
    name: d.name,
    mobile: d.mobile,
    rating: d.rating,
    ratingCount: d.ratingCount,
    orderCount: d.orderCount,
    deliveredCount: d.deliveredCount,
    avgOrdersPerDay: d.avgOrdersPerDay,
    avgDeliveryTimeMinutes: d.avgDeliveryTimeMinutes ?? '',
    archived: d.archived ? 'yes' : 'no',
    isBlocked: d.isBlocked ? 'yes' : 'no',
  }));
  return { storeRows, driverRows };
}

module.exports = {
  buildDriverStatsOverview,
  buildAdminStatsOverview,
  statsOverviewToExportRows,
};
