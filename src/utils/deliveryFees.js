/**
 * Store orders: 1 JOD for the first km + 0.1 JOD per additional km, max 3 JOD.
 * Arheb Box: 1 JOD for the first km + 0.5 JOD per additional km, no cap.
 *
 * **Dashboard fixed zones** (`delivery_fixed_zones` table): haversine radius around each pin; flat **feeJod**
 * (default seed 2 JOD / 3 km for جامعة العقبة للتكنولوجيا & تالا باي). Applies to store + Arheb Box after special-far pins.
 *
 * Special far desert zones (Wadi Rum, Al Quwayrah, etc.): fixed fee (default 10 JOD)
 * when the customer dropoff is within SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM of a pin.
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
} = require('./deliveryFixedZones');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function nonNegativeNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
function resolveSpecialFarDeliveryFeeJod(tiers) {
  const configured = nonNegativeNumberOrNull(tiers?.specialFarDeliveryFeeJod);
  return configured != null ? configured : SPECIAL_FAR_DELIVERY_ZONE_FEE_JOD;
}

function specialFarDeliveryZoneFixedFeeJod(lat, lng, tiers) {
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  for (const z of SPECIAL_FAR_DELIVERY_ZONE_CENTERS) {
    if (haversineKm(la, ln, z.lat, z.lon) <= SPECIAL_FAR_DELIVERY_ZONE_RADIUS_KM) {
      return round2(resolveSpecialFarDeliveryFeeJod(tiers));
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
  const special = specialFarDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng, tiers);
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

/** Pure distance tiers only (no special/remote/dashboard zones, no platform flat). Used as resolve fallback. */
function storeOrderDeliveryFeeDistanceOnly(distanceKm, tiers) {
  const firstKm = tiers?.firstKmJod != null && Number.isFinite(Number(tiers.firstKmJod)) ? Number(tiers.firstKmJod) : 1;
  const perKm = tiers?.perKmJod != null && Number.isFinite(Number(tiers.perKmJod)) ? Number(tiers.perKmJod) : 0.1;
  const maxJod = tiers?.maxJod != null && Number.isFinite(Number(tiers.maxJod)) ? Number(tiers.maxJod) : STORE_MAX_JOD;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const fee = firstKm + perKm * beyondFirst;
  return round2(Math.min(maxJod, fee));
}

function storeOrderDeliveryFeeJod(distanceKm, deliveryLat, deliveryLng, db) {
  return storeOrderDeliveryFeeFromDistanceTiers(distanceKm, deliveryLat, deliveryLng, {}, db);
}

/**
 * Platform service fee default (JOD) with per-store overrides from stores JSON.
 * `checkoutServiceFeeDisabled: true` → 0; `checkoutServiceFeeJod` → fixed amount; else platform default.
 */
/** Per-store bulk checkout delivery from Stores dashboard (`checkoutDeliveryFeeJod` / free flag). */
function getStoreBulkCheckoutDeliveryFeeJod(storeJson) {
  if (!storeJson) return null;
  if (storeJson.checkoutDeliveryFeeZero === true) return 0;
  if (storeJson.checkoutDeliveryFeeJod != null && storeJson.checkoutDeliveryFeeJod !== '') {
    const v = Number(storeJson.checkoutDeliveryFeeJod);
    if (Number.isFinite(v) && v >= 0) return round2(v);
  }
  return null;
}

/** Store card / listing fee when dropoff is unknown — prefer bulk policy, then App Info flat, then legacy field. */
function effectiveStoreListingDeliveryFeeJod(storeJson, platformTiers) {
  const bulk = getStoreBulkCheckoutDeliveryFeeJod(storeJson);
  if (bulk != null) return bulk;
  const flatRaw = platformTiers?.flatDeliveryFeeJod;
  if (flatRaw != null && String(flatRaw).trim() !== '') {
    const fv = Number(flatRaw);
    if (Number.isFinite(fv) && fv >= 0) return round2(fv);
  }
  if (storeJson && typeof storeJson.deliveryFee === 'number' && Number.isFinite(storeJson.deliveryFee)) {
    return round2(Math.max(0, storeJson.deliveryFee));
  }
  return null;
}

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
 *   2. Remote delivery zone pins → fixed fee (default 8 JOD).
 *   3. Per-store bulk checkout (`checkoutDeliveryFeeJod` / `checkoutDeliveryFeeZero`) when set on the store.
 *   4. Dashboard fixed circular zones (`delivery_fixed_zones`) — only when the store has no bulk checkout override.
 *   5. Platform flat delivery from App Info (`flatDeliveryFeeJod`).
 *   6. Per-store cart threshold (`checkoutDeliveryOverCartThresholdJod` + `checkoutDeliveryFeeAboveJod`).
 *   7. Platform-wide cart threshold (`platformTiers.deliveryOverCartThresholdJod` + `deliveryFeeAboveJod`).
 *   8. Distance-based `computedFromDistanceJod` (first km + per km, capped at max).
 *
 * @param {object | null} storeJson
 * @param {number} computedFromDistanceJod
 * @param {number} [deliveryLat] customer dropoff
 * @param {number} [deliveryLng]
 * @param {{ cartAmountJod?: number | null, platformTiers?: { deliveryOverCartThresholdJod?: number | null, deliveryFeeAboveJod?: number | null } | null, db?: import('better-sqlite3').Database }} [options]
 */
function resolveStoreOrderDeliveryFeeJodDetailed(
  storeJson,
  computedFromDistanceJod,
  deliveryLat,
  deliveryLng,
  options,
) {
  const platformTiers = options && options.platformTiers ? options.platformTiers : null;

  const specialFar = specialFarDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng, platformTiers);
  if (specialFar != null) return { fee: specialFar, source: 'special_far_zone' };

  const remote = remoteDeliveryZoneFixedFeeJod(deliveryLat, deliveryLng);
  if (remote != null) return { fee: remote, source: 'remote_zone' };

  const bulkFee = getStoreBulkCheckoutDeliveryFeeJod(storeJson);
  if (bulkFee != null) {
    return {
      fee: bulkFee,
      source: bulkFee === 0 ? 'store_free_delivery' : 'store_bulk_checkout',
    };
  }

  const dashboardZoneFee = matchFixedDeliveryZoneFeeJod(deliveryLat, deliveryLng, options?.db);
  if (dashboardZoneFee != null) {
    return { fee: round2(dashboardZoneFee), source: 'dashboard_fixed_zone' };
  }

  if (platformTiers) {
    const flatRaw = platformTiers.flatDeliveryFeeJod;
    if (flatRaw != null && String(flatRaw).trim() !== '') {
      const fv = Number(flatRaw);
      if (Number.isFinite(fv) && fv >= 0) {
        return { fee: round2(fv), source: 'platform_flat_delivery' };
      }
    }
  }

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
        return { fee: round2(feeAbove), source: 'store_cart_threshold' };
      }
    }
  }

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
        return { fee: round2(feeAbove), source: 'platform_cart_threshold' };
      }
    }
  }

  return { fee: round2(Math.max(0, base)), source: 'distance_tiers' };
}

function resolveStoreOrderDeliveryFeeJod(storeJson, computedFromDistanceJod, deliveryLat, deliveryLng, options) {
  return resolveStoreOrderDeliveryFeeJodDetailed(
    storeJson,
    computedFromDistanceJod,
    deliveryLat,
    deliveryLng,
    options,
  ).fee;
}

/**
 * @param {number} distanceKm
 * @param {number} [dropoffLat]
 * @param {number} [dropoffLng]
 * @param {import('better-sqlite3').Database} [db]
 */
function arhebBoxDeliveryFeeFromDistanceJod(distanceKm, dropoffLat, dropoffLng, db, tiers) {
  const special = specialFarDeliveryZoneFixedFeeJod(dropoffLat, dropoffLng, tiers);
  if (special != null) return special;
  const dashFee = matchFixedDeliveryZoneFeeJod(dropoffLat, dropoffLng, db);
  if (dashFee != null) return dashFee;
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const remote = remoteDeliveryZoneFixedFeeJod(dropoffLat, dropoffLng);
  if (remote != null) return remote;
  const flatRaw = tiers?.arhebBoxFlatDeliveryFeeJod;
  if (flatRaw != null && String(flatRaw).trim() !== '') {
    const fv = Number(flatRaw);
    if (Number.isFinite(fv) && fv >= 0) {
      return round2(fv);
    }
  }
  const firstKm = nonNegativeNumberOrNull(tiers?.arhebBoxFirstKmJod) ?? 1;
  const perKm = nonNegativeNumberOrNull(tiers?.arhebBoxPerKmJod) ?? 0.5;
  const maxJod = nonNegativeNumberOrNull(tiers?.arhebBoxMaxJod);
  const raw = firstKm + perKm * beyondFirst;
  return round2(maxJod != null ? Math.min(maxJod, raw) : raw);
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
  resolveSpecialFarDeliveryFeeJod,
  remoteDeliveryZoneFixedFeeJod,
  specialFarDeliveryZoneFixedFeeJod,
  dropoffInSpecialFarDeliveryZone,
  storeOrderDeliveryFeeFromDistanceTiers,
  storeOrderDeliveryFeeDistanceOnly,
  storeOrderDeliveryFeeJod,
  getStoreBulkCheckoutDeliveryFeeJod,
  effectiveStoreListingDeliveryFeeJod,
  resolveStoreOrderServiceFeeJod,
  resolveStoreOrderDeliveryFeeJod,
  resolveStoreOrderDeliveryFeeJodDetailed,
  arhebBoxDeliveryFeeFromDistanceJod,
  round2,
};
