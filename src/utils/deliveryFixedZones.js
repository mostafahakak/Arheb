/**
 * Dashboard-configurable fixed delivery fees for circular zones (WGS84 haversine km — “real” km, not road routing).
 * Zones are configured via the dashboard (App Info). Default seed (تالا باي & جامعة العقبة) is inserted once when the table is empty.
 */

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Default pins (WGS84) from Google Maps place / directions:
 * جامعة العقبة للتكنولوجيا — destination lat/lng from Maps (~29.4368563, 35.0125407)
 * تالا باي — The Beach Club, Tala Bay (29.411629, 34.978631)
 */
const DEFAULT_ZONES = [
  { sortOrder: 0, label: 'جامعة العقبة للتكنولوجيا', centerLat: 29.4368563, centerLon: 35.0125407, radiusKm: 3, feeJod: 2 },
  { sortOrder: 1, label: 'تالا باي', centerLat: 29.411629, centerLon: 34.978631, radiusKm: 3, feeJod: 2 },
];

/** One-time: nudge rows still on older seed pins toward current Maps anchors. */
const LEGACY_PIN_UPDATES = [
  { oldLat: 29.5488, oldLon: 35.0025, newLat: 29.4368563, newLon: 35.0125407 },
  { oldLat: 29.4369224, oldLon: 35.0128589, newLat: 29.4368563, newLon: 35.0125407 },
  { oldLat: 29.3915, oldLon: 34.9795, newLat: 29.411629, newLon: 34.978631 },
  { oldLat: 29.4091955, oldLon: 34.9798154, newLat: 29.411629, newLon: 34.978631 },
];

function migrateLegacyDeliveryPinCoordinates(db) {
  if (!db) return;
  const stmt = db.prepare(
    `UPDATE delivery_fixed_zones SET centerLat = @newLat, centerLon = @newLon, updatedAt = datetime('now')
     WHERE ABS(centerLat - @oldLat) < 0.002 AND ABS(centerLon - @oldLon) < 0.002`,
  );
  for (const m of LEGACY_PIN_UPDATES) {
    stmt.run({ newLat: m.newLat, newLon: m.newLon, oldLat: m.oldLat, oldLon: m.oldLon });
  }
}

function ensureDeliveryFixedZonesTable(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_fixed_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      centerLat REAL NOT NULL,
      centerLon REAL NOT NULL,
      radiusKm REAL NOT NULL DEFAULT 3,
      feeJod REAL NOT NULL DEFAULT 2,
      enabled INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT
    );
  `);
}

function seedDeliveryFixedZonesIfEmpty(db) {
  ensureDeliveryFixedZonesTable(db);
  migrateLegacyDeliveryPinCoordinates(db);
}

function seedDefaultDeliveryFixedZonesIfEmpty(db) {
  ensureDeliveryFixedZonesTable(db);
  migrateLegacyDeliveryPinCoordinates(db);
  const row = db.prepare('SELECT COUNT(*) AS c FROM delivery_fixed_zones').get();
  if (!row || row.c > 0) return false;
  const ins = db.prepare(
    `INSERT INTO delivery_fixed_zones (sortOrder, label, centerLat, centerLon, radiusKm, feeJod, enabled, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
  );
  for (const z of DEFAULT_ZONES) {
    ins.run(z.sortOrder, z.label, z.centerLat, z.centerLon, z.radiusKm, z.feeJod);
  }
  return true;
}

/**
 * First matching zone by sortOrder wins when overlapping.
 * @returns {number | null} fee JOD or null if outside all zones / disabled / invalid coords
 */
function matchFixedDeliveryZoneFeeJod(lat, lng, db) {
  if (!db) return null;
  seedDefaultDeliveryFixedZonesIfEmpty(db);
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const rows = db
    .prepare(
      `SELECT centerLat, centerLon, radiusKm, feeJod, enabled FROM delivery_fixed_zones ORDER BY sortOrder ASC, id ASC`,
    )
    .all();
  for (const z of rows) {
    if (Number(z.enabled) !== 1) continue;
    const rKm = Number(z.radiusKm);
    const radius = Number.isFinite(rKm) && rKm > 0 ? rKm : 3;
    const fee = Number(z.feeJod);
    if (!Number.isFinite(fee) || fee < 0) continue;
    const dist = haversineKm(la, ln, Number(z.centerLat), Number(z.centerLon));
    if (dist <= radius + 1e-9) {
      return round2(fee);
    }
  }
  return null;
}

function dropoffInDashboardFixedDeliveryZone(lat, lng, db) {
  return matchFixedDeliveryZoneFeeJod(lat, lng, db) != null;
}

function listDeliveryFixedZones(db) {
  seedDefaultDeliveryFixedZonesIfEmpty(db);
  return db
    .prepare(
      `SELECT id, sortOrder, label, centerLat, centerLon, radiusKm, feeJod, enabled FROM delivery_fixed_zones ORDER BY sortOrder ASC, id ASC`,
    )
    .all();
}

/**
 * Replace all zones (SuperAdmin). Validates rows.
 * @param {import('better-sqlite3').Database} db
 * @param {Array<{ label?: string, centerLat: number, centerLon: number, radiusKm?: number, feeJod?: number, enabled?: boolean|number, sortOrder?: number }>} zones
 */
function replaceDeliveryFixedZones(db, zones) {
  ensureDeliveryFixedZonesTable(db);
  if (!Array.isArray(zones)) {
    const err = new Error('zones must be an array');
    err.code = 'VALIDATION';
    throw err;
  }
  const normalized = [];
  let order = 0;
  for (const raw of zones) {
    if (!raw || typeof raw !== 'object') continue;
    const lat = Number(raw.centerLat);
    const lon = Number(raw.centerLon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      const err = new Error('Each zone requires valid centerLat / centerLon');
      err.code = 'VALIDATION';
      throw err;
    }
    const radiusKm = raw.radiusKm != null && raw.radiusKm !== '' ? Number(raw.radiusKm) : 3;
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      const err = new Error('radiusKm must be a positive number');
      err.code = 'VALIDATION';
      throw err;
    }
    const feeJod = raw.feeJod != null && raw.feeJod !== '' ? Number(raw.feeJod) : 2;
    if (!Number.isFinite(feeJod) || feeJod < 0) {
      const err = new Error('feeJod must be a non-negative number');
      err.code = 'VALIDATION';
      throw err;
    }
    const enabled = raw.enabled === false || raw.enabled === 0 || raw.enabled === '0' ? 0 : 1;
    const sortOrder = raw.sortOrder != null ? Number(raw.sortOrder) : order;
    const label = raw.label != null && String(raw.label).trim() !== '' ? String(raw.label).trim() : null;
    normalized.push({
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : order,
      label,
      centerLat: lat,
      centerLon: lon,
      radiusKm,
      feeJod,
      enabled,
    });
    order += 1;
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM delivery_fixed_zones').run();
    const ins = db.prepare(
      `INSERT INTO delivery_fixed_zones (sortOrder, label, centerLat, centerLon, radiusKm, feeJod, enabled, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    for (const z of normalized) {
      ins.run(z.sortOrder, z.label, z.centerLat, z.centerLon, z.radiusKm, z.feeJod, z.enabled);
    }
  });
  tx();
  return listDeliveryFixedZones(db);
}

module.exports = {
  ensureDeliveryFixedZonesTable,
  seedDeliveryFixedZonesIfEmpty,
  seedDefaultDeliveryFixedZonesIfEmpty,
  matchFixedDeliveryZoneFeeJod,
  dropoffInDashboardFixedDeliveryZone,
  listDeliveryFixedZones,
  replaceDeliveryFixedZones,
  DEFAULT_ZONES,
};
