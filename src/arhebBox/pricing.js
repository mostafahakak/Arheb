const { arhebBoxDeliveryFeeFromDistanceJod } = require('../utils/deliveryFees');

/** Haversine distance in km between two WGS84 points. */
function distanceKm(lat1, lon1, lat2, lon2) {
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
 * Minimum parcel amount (JOD) for the route — same basis as Arheb Box delivery fee.
 * @param {import('better-sqlite3').Database} [db]
 */
function minAmountJod(distanceKm, dropoff, db, tiers) {
  const lat = dropoff?.latitude;
  const lng = dropoff?.longitude;
  if (typeof distanceKm !== 'number' || distanceKm < 0 || Number.isNaN(distanceKm)) {
    return arhebBoxDeliveryFeeFromDistanceJod(0, lat, lng, db, tiers);
  }
  return arhebBoxDeliveryFeeFromDistanceJod(distanceKm, lat, lng, db, tiers);
}

function quoteFromPickupDropoff(pickup, dropoff, db, tiers) {
  const lat1 = pickup?.latitude;
  const lon1 = pickup?.longitude;
  const lat2 = dropoff?.latitude;
  const lon2 = dropoff?.longitude;
  if (typeof lat1 !== 'number' || typeof lon1 !== 'number' || typeof lat2 !== 'number' || typeof lon2 !== 'number') {
    return null;
  }
  const dKm = distanceKm(lat1, lon1, lat2, lon2);
  return {
    distanceKm: Math.round(dKm * 1000) / 1000,
    minAmountJod: minAmountJod(dKm, dropoff, db, tiers),
  };
}

module.exports = { distanceKm, minAmountJod, quoteFromPickupDropoff };
