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
/**
 * Distance-based store delivery using configurable tiers (defaults match legacy1 + 0.1/km, max 3).
 * @param {{ firstKmJod?: number, perKmJod?: number, maxJod?: number }} [tiers]
 */
function storeOrderDeliveryFeeFromDistanceTiers(distanceKm, deliveryLat, deliveryLng, tiers) {
  const remote = remoteDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (remote != null) return remote;
  const firstKm = tiers?.firstKmJod != null && Number.isFinite(Number(tiers.firstKmJod)) ? Number(tiers.firstKmJod) : 1;
  const perKm = tiers?.perKmJod != null && Number.isFinite(Number(tiers.perKmJod)) ? Number(tiers.perKmJod) : 0.1;
  const maxJod = tiers?.maxJod != null && Number.isFinite(Number(tiers.maxJod)) ? Number(tiers.maxJod) : STORE_MAX_JOD;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const fee = firstKm + perKm * beyondFirst;
  return round2(Math.min(maxJod, fee));
}

function storeOrderDeliveryFeeJod(distanceKm, deliveryLat, deliveryLng) {
  return storeOrderDeliveryFeeFromDistanceTiers(distanceKm, deliveryLat, deliveryLng, {});
}

/**
 * Platform service fee default (JOD) with per-store overrides from stores JSON.
 * `checkoutServiceFeeDisabled: true` → 0; `checkoutServiceFeeJod` → fixed amount; else platform default.
 */
function resolveStoreOrderServiceFeeJod(storeJson, platformDefaultServiceFeeJod) {
  const def =
    platformDefaultServiceFeeJod != null && Number.isFinite(Number(platformDefaultServiceFeeJod))
      ? Number(platformDefaultServiceFeeJod)
      : STORE_ORDER_SERVICE_FEE_JOD;
  if (!storeJson) return round2(Math.max(0, def));
  if (storeJson.checkoutServiceFeeDisabled === true) return 0;
  if (storeJson.checkoutServiceFeeJod != null && storeJson.checkoutServiceFeeJod !== '') {
    const v = Number(storeJson.checkoutServiceFeeJod);
    if (Number.isFinite(v) && v >= 0) return round2(v);
  }
  return round2(Math.max(0, def));
}

/**
 * Checkout delivery: `checkoutDeliveryFeeZero` → 0; else optional fixed `checkoutDeliveryFeeJod`;
 * otherwise distance-based `computedFromDistanceJod` (tiers / remote zones).
 */
function resolveStoreOrderDeliveryFeeJod(storeJson, computedFromDistanceJod) {
  const base =
    computedFromDistanceJod != null && Number.isFinite(Number(computedFromDistanceJod))
      ? Number(computedFromDistanceJod)
      : 0;
  if (!storeJson) return round2(Math.max(0, base));
  if (storeJson.checkoutDeliveryFeeZero === true) return 0;
  if (storeJson.checkoutDeliveryFeeJod != null && storeJson.checkoutDeliveryFeeJod !== '') {
    const v = Number(storeJson.checkoutDeliveryFeeJod);
    if (Number.isFinite(v) && v >= 0) return round2(v);
  }
  return round2(Math.max(0, base));
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
  storeOrderDeliveryFeeFromDistanceTiers,
  storeOrderDeliveryFeeJod,
  resolveStoreOrderServiceFeeJod,
  resolveStoreOrderDeliveryFeeJod,
  arhebBoxDeliveryFeeFromDistanceJod,
  round2,
};
