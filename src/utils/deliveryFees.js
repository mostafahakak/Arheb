/**
 * Store orders: 1 JOD for the first km + 0.1 JOD per additional km, max 3 JOD.
 * Arheb Box: 1 JOD for the first km + 0.5 JOD per additional km, no cap.
 *
 * Uncapped tier zones (**only** narrow radii around the two pins in `UNCAPPED_TIER_ZONE_CENTERS`): same 1 + 0.1/km as tiers but **no maxJod**.
 * Rest of Aqaba uses normal platform tiers (max 3 JOD by default).
 * Arheb Box uses the **same** 1 + 0.1/km in these zones (not 0.5/km). Checked before remote fixed 8 JOD.
 *
 * Special far desert zones (Wadi Rum, Al Quwayrah, etc.): fixed SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD
 * (default 10) when the customer dropoff is within SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM of a pin.
 * This overrides per-store checkout delivery settings (custom fee, free delivery).
 *
 * Remote delivery zones (other pins): fixed fee REMOTE_DELIVERY_ZONE_FEE_JOD (default 8)
 * when dropoff is within REMOTE_DELIVERY_ZONE_RADIUS_KM of those centers.
 * Evaluated only outside special far zones.
 *
 * Service fee: applies to store orders only (added to taxable base with delivery).
 * Arheb Box: platform service fee is configurable (default 0.65 JOD); VAT is 7% on delivery + service fee.
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

const SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD = (() => {
  const v = Number(process.env.SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD);
  return Number.isFinite(v) && v > 0 ? v : 10;
})();

/** Wider than generic remote (3 km): shared map pins often differ from town-centroid coords. */
const SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM = (() => {
  const raw =
    process.env.SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM ?? process.env.STORE_UNCAPPED_DELIVERY_ZONE_RADIUS_KM;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : 10;
})();

/**
 * Far south / desert pins: fixed SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD — not eligible for store checkout overrides.
 * Same pattern as other entries: { id, lat, lon } — align with shared Maps pins / same anchors as REMOTE where applicable.
 * Tune radius with SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM if needed (default 10 km).
 */
const SPECIAL_FAR_DELIVERY_ZONE_CENTERS = [
  { id: 'wadi-rum', lat: 29.5743, lon: 35.421 },
  { id: 'al-quwayrah', lat: 29.7967, lon: 35.3153 },
  /** Al Shakriyah (maps short link MCJR+H2P / Shakaria) */
  { id: 'al-shakriyah', lat: 29.6505, lon: 35.3525 },
  { id: 'ar-rashidiyah', lat: 29.7324, lon: 35.281 },
  /** At-Tuweisa — same anchor as REMOTE `at-tuweisa` */
  { id: 'at-tuweisa', lat: 29.6523356, lon: 35.5447918 },
  /** Ad Disah — same anchor as REMOTE `ad-disah` (maps MGQ2+PPR / Ad Disah) */
  { id: 'ad-disah', lat: 29.652699, lon: 35.5104853 },
];

/**
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {number | null} fixed JOD fee if inside any special far zone, else null
 */
function specialFarDeliveryZoneFixedFeeJod(lat, lng) {
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  for (const z of SPECIAL_FAR_DELIVERY_ZONE_CENTERS) {
    if (haversineKm(la, ln, z.lat, z.lon) <= SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM) {
      return round2(SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD);
    }
  }
  return null;
}

/**
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {boolean}
 */
function dropoffInSpecialFarDeliveryZone(lat, lng) {
  return specialFarDeliveryZoneFixedFeeJod(lat, lng) != null;
}

/**
 * Only dropoffs **within this radius** of an uncapped pin get “no max” tier pricing.
 * Default **2.5 km** — a 10 km radius made almost all of Aqaba hit uncapped (no 3 JOD cap) and broke platform tiers citywide.
 * Widen only if needed, e.g. `UNCAPPED_TIER_ZONE_RADIUS_KM=4` on the host.
 */
const UNCAPPED_TIER_ZONE_RADIUS_KM = (() => {
  const v = Number(process.env.UNCAPPED_TIER_ZONE_RADIUS_KM);
  return Number.isFinite(v) && v > 0 ? v : 2.5;
})();

/**
 * **Uncapped tier** (platform first km + per km, **no maxJod cap**): only these two areas — nowhere else in Aqaba.
 * جامعة العقبة للتكنولوجيا (Aqaba University of Technology) & Tala Bay. Tune coords from Google Maps → Share.
 * Special **10 JOD** desert/far pins use `SPECIAL_FAR_DELIVERY_ZONE_CENTERS` (separate list).
 */
const UNCAPPED_TIER_ZONE_CENTERS = [
  { id: 'aqaba-university-of-technology', lat: 29.5488, lon: 35.0025 },
  { id: 'tala-bay', lat: 29.3915, lon: 34.9795 },
];

/**
 * @param {unknown} lat
 * @param {unknown} lng
 * @returns {boolean}
 */
function dropoffInUncappedTierZone(lat, lng) {
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  for (const z of UNCAPPED_TIER_ZONE_CENTERS) {
    if (haversineKm(la, ln, z.lat, z.lon) <= UNCAPPED_TIER_ZONE_RADIUS_KM) return true;
  }
  return false;
}

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

/** Default Arheb Box platform service fee (JOD) when DB app info is unset. */
const ARHEB_BOX_SERVICE_FEE_JOD = 0.65;

/**
 * Distance-based store delivery using configurable tiers (defaults match legacy1 + 0.1/km, max 3).
 * Optional `tiers.flatDeliveryFeeJod`: when set, that amount is used for normal dropoffs (not special/uncapped/remote).
 * @param {{ firstKmJod?: number, perKmJod?: number, maxJod?: number, flatDeliveryFeeJod?: number | null }} [tiers]
 */
function storeOrderDeliveryFeeFromDistanceTiers(distanceKm, deliveryLat, deliveryLng, tiers) {
  const special = specialFarDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (special != null) return special;

  const firstKm = tiers?.firstKmJod != null && Number.isFinite(Number(tiers.firstKmJod)) ? Number(tiers.firstKmJod) : 1;
  const perKm = tiers?.perKmJod != null && Number.isFinite(Number(tiers.perKmJod)) ? Number(tiers.perKmJod) : 0.1;
  const maxJod = tiers?.maxJod != null && Number.isFinite(Number(tiers.maxJod)) ? Number(tiers.maxJod) : STORE_MAX_JOD;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const fee = firstKm + perKm * beyondFirst;

  if (dropoffInUncappedTierZone(deliveryLat, deliveryLng)) {
    return round2(fee);
  }

  const remote = remoteDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (remote != null) return remote;

  const flatRaw = tiers?.flatDeliveryFeeJod;
  if (flatRaw != null && String(flatRaw).trim() !== '') {
    const fv = Number(flatRaw);
    if (Number.isFinite(fv) && fv >= 0) {
      return round2(fv);
    }
  }

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
 * Checkout delivery: special far desert dropoffs → fixed platform fee (ignores store overrides);
 * else optional fixed `checkoutDeliveryFeeJod` from dashboard; else `checkoutDeliveryFeeZero` (with remote/uncapped exceptions);
 * else distance-based `computedFromDistanceJod`.
 *
 * @param {object | null} storeJson
 * @param {number} computedFromDistanceJod
 * @param {number} [deliveryLat] customer dropoff
 * @param {number} [deliveryLng]
 */
function resolveStoreOrderDeliveryFeeJod(storeJson, computedFromDistanceJod, deliveryLat, deliveryLng) {
  const specialFar = specialFarDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (specialFar != null) return specialFar;

  const base =
    computedFromDistanceJod != null && Number.isFinite(Number(computedFromDistanceJod))
      ? Number(computedFromDistanceJod)
      : 0;
  if (!storeJson) return round2(Math.max(0, base));
  if (storeJson.checkoutDeliveryFeeJod != null && storeJson.checkoutDeliveryFeeJod !== '') {
    const v = Number(storeJson.checkoutDeliveryFeeJod);
    if (Number.isFinite(v) && v >= 0) return round2(v);
  }
  const inRemoteZone = remoteDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng) != null;
  if (storeJson.checkoutDeliveryFeeZero === true && !inRemoteZone && !dropoffInUncappedTierZone(deliveryLat, deliveryLng)) {
    return 0;
  }
  return round2(Math.max(0, base));
}

/**
 * @param {number} distanceKm
 * @param {number} [dropoffLat]
 * @param {number} [dropoffLng]
 */
function arhebBoxDeliveryFeeFromDistanceJod(distanceKm, dropoffLat, dropoffLng) {
  const special = specialFarDeliveryZoneFixedFeeJod(dropoffLat, dropoffLng);
  if (special != null) return special;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const storeStylePerKm = round2(1 + 0.1 * beyondFirst);
  if (dropoffInUncappedTierZone(dropoffLat, dropoffLng)) {
    return storeStylePerKm;
  }
  const remote = remoteDeliveryZoneFixedFeeJod(dropoffLat, dropoffLng);
  if (remote != null) return remote;
  return round2(1 + 0.5 * beyondFirst);
}

module.exports = {
  STORE_MAX_JOD,
  STORE_ORDER_SERVICE_FEE_JOD,
  ARHEB_BOX_SERVICE_FEE_JOD,
  REMOTE_DELIVERY_ZONE_FEE_JOD,
  REMOTE_DELIVERY_ZONE_RADIUS_KM,
  SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD,
  SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM,
  SPECIAL_FAR_DELIVERY_ZONE_CENTERS,
  UNCAPPED_TIER_ZONE_RADIUS_KM,
  UNCAPPED_TIER_ZONE_CENTERS,
  remoteDeliveryZoneFixedFeeJod,
  specialFarDeliveryZoneFixedFeeJod,
  dropoffInSpecialFarDeliveryZone,
  dropoffInUncappedTierZone,
  storeOrderDeliveryFeeFromDistanceTiers,
  storeOrderDeliveryFeeJod,
  resolveStoreOrderServiceFeeJod,
  resolveStoreOrderDeliveryFeeJod,
  arhebBoxDeliveryFeeFromDistanceJod,
  round2,
};
