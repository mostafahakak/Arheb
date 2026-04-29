/**
 * Store orders: 1 JOD for the first km + 0.1 JOD per additional km, max 3 JOD.
 * Arheb Box: 1 JOD for the first km + 0.5 JOD per additional km, no cap.
 *
 * **Dashboard fixed zones** (`delivery_fixed_zones` table): haversine radius around each pin; flat **feeJod**
 * (default seed 2 JOD / 3 km for جامعة العقبة للتكنولوجيا & تالا باي). Applies to store + Arheb Box after special-far pins.
 *
 * Special far desert zones (Wadi Rum, Al Quwayrah, etc.): fixed SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD
 * (default 10) when the customer dropoff is within SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM of a pin.
 * This overrides per-store checkout delivery settings (custom fee, free delivery).
 *
 * Remote delivery zones (other pins): fixed fee REMOTE_DELIVERY_ZONE_FEE_JOD (default 8)
 * when dropoff is within REMOTE_DELIVERY_ZONE_RADIUS_KM of those centers.
 * Evaluated only outside special far zones.
 *
 * Service fee: store orders use platform default (and per-store overrides) via `resolveStoreOrderServiceFeeJod`.
 * Arheb Box: platform service fee from App info (`arhebBoxServiceFeeJod`, latest `contact_us` row); delivery fee formula separate.
 */

const {
  matchFixedDeliveryZoneFeeJod,
  dropoffInDashboardFixedDeliveryZone,
} = require('./deliveryFixedZones');

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
const ARHEB_BOX_SERVICE_FEE_JOD = 0;

/**
 * Distance-based store delivery using configurable tiers (defaults match legacy1 + 0.1/km, max 3).
 * Optional `tiers.flatDeliveryFeeJod`: when set, that amount is used for normal dropoffs (not special-far / dashboard zones / remote).
 * @param {{ firstKmJod?: number, perKmJod?: number, maxJod?: number, flatDeliveryFeeJod?: number | null }} [tiers]
 * @param {import('better-sqlite3').Database} [db] — required for dashboard fixed zones (`delivery_fixed_zones`).
 */
function storeOrderDeliveryFeeFromDistanceTiers(distanceKm, deliveryLat, deliveryLng, tiers, db) {
  const special = specialFarDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (special != null) return special;

  const dashFee = matchFixedDeliveryZoneFeeJod(deliveryLat, deliveryLng, db);
  if (dashFee != null) return dashFee;

  const firstKm = tiers?.firstKmJod != null && Number.isFinite(Number(tiers.firstKmJod)) ? Number(tiers.firstKmJod) : 1;
  const perKm = tiers?.perKmJod != null && Number.isFinite(Number(tiers.perKmJod)) ? Number(tiers.perKmJod) : 0.1;
  const maxJod = tiers?.maxJod != null && Number.isFinite(Number(tiers.maxJod)) ? Number(tiers.maxJod) : STORE_MAX_JOD;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const fee = firstKm + perKm * beyondFirst;

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

function storeOrderDeliveryFeeJod(distanceKm, deliveryLat, deliveryLng, db) {
  return storeOrderDeliveryFeeFromDistanceTiers(distanceKm, deliveryLat, deliveryLng, {}, db);
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
 * Checkout delivery order of precedence (first match wins):
 *   1. Special-far desert pins → fixed 10 JOD (never overridden).
 *   2. Per-store cart threshold (`checkoutDeliveryOverCartThresholdJod` + `checkoutDeliveryFeeAboveJod`) — admin-set on the store.
 *   3. Platform-wide cart threshold (`platformTiers.deliveryOverCartThresholdJod` + `deliveryFeeAboveJod`).
 *   4. Per-store fixed fee (`checkoutDeliveryFeeJod`) from dashboard.
 *   5. Per-store free delivery (`checkoutDeliveryFeeZero` — respected outside remote & dashboard fixed zones).
 *   6. Distance-based `computedFromDistanceJod` (already honors tiers / platform flatDeliveryFeeJod).
 *
 * @param {object | null} storeJson
 * @param {number} computedFromDistanceJod
 * @param {number} [deliveryLat] customer dropoff
 * @param {number} [deliveryLng]
 * @param {{ cartAmountJod?: number | null, platformTiers?: { deliveryOverCartThresholdJod?: number | null, deliveryFeeAboveJod?: number | null } | null, db?: import('better-sqlite3').Database }} [options]
 */
function resolveStoreOrderDeliveryFeeJod(storeJson, computedFromDistanceJod, deliveryLat, deliveryLng, options) {
  const specialFar = specialFarDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (specialFar != null) return specialFar;

  const base =
    computedFromDistanceJod != null && Number.isFinite(Number(computedFromDistanceJod))
      ? Number(computedFromDistanceJod)
      : 0;

  const cartAmountJod =
    options && options.cartAmountJod != null && Number.isFinite(Number(options.cartAmountJod))
      ? Number(options.cartAmountJod)
      : null;

  if (storeJson) {
    const storeThresholdRaw = storeJson.checkoutDeliveryOverCartThresholdJod;
    const storeFeeAboveRaw = storeJson.checkoutDeliveryFeeAboveJod;
    if (storeThresholdRaw != null && storeThresholdRaw !== '' && storeFeeAboveRaw != null && storeFeeAboveRaw !== '') {
      const threshold = Number(storeThresholdRaw);
      const feeAbove = Number(storeFeeAboveRaw);
      if (
        Number.isFinite(threshold) &&
        threshold >= 0 &&
        Number.isFinite(feeAbove) &&
        feeAbove >= 0 &&
        cartAmountJod != null &&
        cartAmountJod + 1e-9 >= threshold
      ) {
        return round2(feeAbove);
      }
    }
  }

  const platformTiers = options && options.platformTiers ? options.platformTiers : null;
  if (platformTiers) {
    const platThresholdRaw = platformTiers.deliveryOverCartThresholdJod;
    const platFeeAboveRaw = platformTiers.deliveryFeeAboveJod;
    if (platThresholdRaw != null && platFeeAboveRaw != null) {
      const threshold = Number(platThresholdRaw);
      const feeAbove = Number(platFeeAboveRaw);
      if (
        Number.isFinite(threshold) &&
        threshold >= 0 &&
        Number.isFinite(feeAbove) &&
        feeAbove >= 0 &&
        cartAmountJod != null &&
        cartAmountJod + 1e-9 >= threshold
      ) {
        return round2(feeAbove);
      }
    }
  }

  if (!storeJson) return round2(Math.max(0, base));
  if (storeJson.checkoutDeliveryFeeJod != null && storeJson.checkoutDeliveryFeeJod !== '') {
    const v = Number(storeJson.checkoutDeliveryFeeJod);
    if (Number.isFinite(v) && v >= 0) return round2(v);
  }
  const inRemoteZone = remoteDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng) != null;
  const inDashboardZone = dropoffInDashboardFixedDeliveryZone(deliveryLat, deliveryLng, options?.db);
  if (storeJson.checkoutDeliveryFeeZero === true && !inRemoteZone && !inDashboardZone) {
    return 0;
  }
  return round2(Math.max(0, base));
}

/**
 * @param {number} distanceKm
 * @param {number} [dropoffLat]
 * @param {number} [dropoffLng]
 * @param {import('better-sqlite3').Database} [db]
 */
function arhebBoxDeliveryFeeFromDistanceJod(distanceKm, dropoffLat, dropoffLng, db) {
  const special = specialFarDeliveryZoneFixedFeeJod(dropoffLat, dropoffLng);
  if (special != null) return special;
  const dashFee = matchFixedDeliveryZoneFeeJod(dropoffLat, dropoffLng, db);
  if (dashFee != null) return dashFee;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
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
  remoteDeliveryZoneFixedFeeJod,
  specialFarDeliveryZoneFixedFeeJod,
  dropoffInSpecialFarDeliveryZone,
  storeOrderDeliveryFeeFromDistanceTiers,
  storeOrderDeliveryFeeJod,
  resolveStoreOrderServiceFeeJod,
  resolveStoreOrderDeliveryFeeJod,
  arhebBoxDeliveryFeeFromDistanceJod,
  round2,
};
