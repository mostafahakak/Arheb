'use strict';

const axios = require('axios');

/**
 * Best-effort parse latitude/longitude from a Google Maps URL (no network).
 * @returns {{ latitude: number, longitude: number } | null}
 */
function parseLatLongFromGoogleMapsUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const text = url.trim();
  const patterns = [
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const latitude = Number(m[1]);
      const longitude = Number(m[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  }
  return null;
}

async function resolveFinalMapsUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return u;
  try {
    const r = await axios.get(u, {
      maxRedirects: 10,
      timeout: 8000,
      validateStatus: () => true,
    });
    const finalUrl = r.request?.res?.responseUrl || r.request?.responseURL || u;
    return typeof finalUrl === 'string' ? finalUrl : u;
  } catch {
    return u;
  }
}

/**
 * Pickup coordinates for fee calculation: store lat/long, or from mapsUrl (expand short links, then parse).
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
async function resolveStorePickupLocation(store) {
  if (!store || typeof store !== 'object') return null;
  const lat = Number(store.latitude);
  const lng = Number(store.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { latitude: lat, longitude: lng };
  }
  if (store.mapsUrl && typeof store.mapsUrl === 'string') {
    const expanded = await resolveFinalMapsUrl(store.mapsUrl);
    const parsed = parseLatLongFromGoogleMapsUrl(expanded);
    if (parsed) return parsed;
  }
  return null;
}

module.exports = {
  parseLatLongFromGoogleMapsUrl,
  resolveFinalMapsUrl,
  resolveStorePickupLocation,
};
