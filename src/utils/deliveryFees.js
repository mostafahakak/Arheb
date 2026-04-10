/**
 * Store orders: 1 JOD for the first km + 0.1 JOD per additional km, max 3 JOD.
 * Arheb Box: 1 JOD for the first km + 0.5 JOD per additional km, no cap.
 *
 * Service fee: applies to store orders only (added to taxable base with delivery).
 * Arheb Box: service fee is always 0; VAT is 7% on delivery fee only.
 */

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const STORE_MAX_JOD = 3;

/** Platform service fee (JOD) on store checkout — not charged on Arheb Box. */
const STORE_ORDER_SERVICE_FEE_JOD = 0.65;

/** Arheb Box has no platform service fee. */
const ARHEB_BOX_SERVICE_FEE_JOD = 0;

/** @param {number} distanceKm */
function storeOrderDeliveryFeeJod(distanceKm) {
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  const fee = 1 + 0.1 * beyondFirst;
  return round2(Math.min(STORE_MAX_JOD, fee));
}

/** @param {number} distanceKm */
function arhebBoxDeliveryFeeFromDistanceJod(distanceKm) {
  const d = typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const beyondFirst = Math.max(0, d - 1);
  return round2(1 + 0.5 * beyondFirst);
}

module.exports = {
  STORE_MAX_JOD,
  STORE_ORDER_SERVICE_FEE_JOD,
  ARHEB_BOX_SERVICE_FEE_JOD,
  storeOrderDeliveryFeeJod,
  arhebBoxDeliveryFeeFromDistanceJod,
  round2,
};
