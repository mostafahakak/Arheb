/**
 * Store orders: 1 JOD for the first km + 0.1 JOD per additional km, max 3 JOD.
 * Arheb Box: 1 JOD for the first km + 0.5 JOD per additional km, no cap.
 *
 * Remote delivery zones (far south / desert): fixed fee REMOTE_DELIVERY_ZONE_FEE_JOD (default 8)
 * when the customer dropoff (store order: delivery address) is within REMOTE_DELIVERY_ZONE_RADIUS_KM
 * of a configured center — overrides store max (3) and Arheb Box distance pricing.
 *
 * Service fee: applies to store orders only (added to taxable base with delivery).
 * Arheb Box: service fee is always 0; VAT is 7% on delivery fee only.
 */

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const EARTH_RADIUS_KM = 6371;

/** Haversine distance in km (WGS84). */
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

const REMOTE_DELIVERY_ZONE_FEE_JOD = (() => {
  const v = Number(process.env.REMOTE_DELIVERY_ZONE_FEE_JOD);
  return Number.isFinite(v) && v > 0 ? v : 8;
})();

const REMOTE_DELIVERY_ZONE_RADIUS_KM = (() => {
  const v = Number(process.env.REMOTE_DELIVERY_ZONE_RADIUS_KM);
  return Number.isFinite(v) && v > 0 ? v : 3;
})();

/**
 * Centers from product config (Google Maps). Radius is shared; tune via REMOTE_DELIVERY_ZONE_RADIUS_KM.
 * Order: maps pin 1, Ad Disah, At-Tuweisa (south Jordan).
 */
const REMOTE_DELIVERY_ZONE_CENTERS = [
  { id: 'remote-1', lat: 30.0329402, lon: 31.4341895 },
  { id: 'ad-disah', lat: 29.652699, lon: 35.5104853 },
  { id: 'at-tuweisa', lat: 29.6523356, lon: 35.5447918 },
];

/**
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {number | null} fixed JOD fee if inside any remote zone, else null
 */
function remoteDeliveryZoneFixedFeeJod(lat, lng) {
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  for (const z of REMOTE_DELIVERY_ZONE_CENTERS) {
    if (haversineKm(la, ln, z.lat, z.lon) <= REMOTE_DELIVERY_ZONE_RADIUS_KM) {
      return round2(REMOTE_DELIVERY_ZONE_FEE_JOD);
    }
  }
  return null;
}

const STORE_MAX_JOD = 3;

/** Platform service fee (JOD) on store checkout — not charged on Arheb Box. */
const STORE_ORDER_SERVICE_FEE_JOD = 0.65;

/** Arheb Box has no platform service fee. */
const ARHEB_BOX_SERVICE_FEE_JOD = 0;

/**
 * @param {number} distanceKm
 * @param {number} [deliveryLat] customer delivery latitude — if inside a remote zone, fee is fixed (default 8 JOD)
 * @param {number} [deliveryLng]
 */
function storeOrderDeliveryFeeJod(distanceKm, deliveryLat, deliveryLng) {
  const remote = remoteDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (remote != null) return remote;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const fee = 1 + 0.1 * beyondFirst;
  return round2(Math.min(STORE_MAX_JOD, fee));
}

/**
 * @param {number} distanceKm
 * @param {number} [dropoffLat]
 * @param {number} [dropoffLng]
 */
function arhebBoxDeliveryFeeFromDistanceJod(distanceKm, dropoffLat, dropoffLng) {
  const remote = remoteDeliveryZoneFixedFeeJod(dropoffLat, dropoffLng);
  if (remote != null) return remote;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  return round2(1 + 0.5 * beyondFirst);
}

module.exports = {
  STORE_MAX_JOD,
  STORE_ORDER_SERVICE_FEE_JOD,
  ARHEB_BOX_SERVICE_FEE_JOD,
  REMOTE_DELIVERY_ZONE_FEE_JOD,
  REMOTE_DELIVERY_ZONE_RADIUS_KM,
  remoteDeliveryZoneFixedFeeJod,
  storeOrderDeliveryFeeJod,
  arhebBoxDeliveryFeeFromDistanceJod,
  round2,
};
