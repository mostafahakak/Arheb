'use strict';

const axios = require('axios');

/**
 * Best-effort parse latitude/longitude from a Google Maps URL (no network).
 * @returns {{ latitude: number, longitude: number } | null}
 */
function parseLatLongFromGoogleMapsUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let text = url.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    /* keep raw */
  }
  const patterns = [
    /[?&]q=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
    /[?&]query=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
    /** Short links often expand to `.../maps/search/29.53,+35.01?...` (no @ or q=). */
    /\/maps\/search\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
    /\/search\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/i,
    /** Encoded place payload fragments e.g. !3d29.5!4d35.0 */
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
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
  const lat = Number(store.latitude ?? store.lat);
  const lng = Number(store.longitude ?? store.long);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { latitude: lat, longitude: lng };
  }
  if (store.mapsUrl && typeof store.mapsUrl === 'string') {
    const sync = parseLatLongFromGoogleMapsUrl(store.mapsUrl);
    if (sync) return sync;
    const expanded = await resolveFinalMapsUrl(store.mapsUrl);
    const parsed =
      parseLatLongFromGoogleMapsUrl(expanded) || parseLatLongFromGoogleMapsUrl(store.mapsUrl);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Store pickup point for nearest-driver matching (sync parse first, then expand short Maps links).
 * @returns {Promise<{ storeLat: number|null, storeLong: number|null }>}
 */
async function resolveStoreCoordsForDriverMatching(store) {
  if (!store || typeof store !== 'object') return { storeLat: null, storeLong: null };
  const lat = Number(store.latitude ?? store.lat);
  const lng = Number(store.longitude ?? store.long);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { storeLat: lat, storeLong: lng };
  }
  const sync = store.mapsUrl ? parseLatLongFromGoogleMapsUrl(store.mapsUrl) : null;
  if (sync) return { storeLat: sync.latitude, storeLong: sync.longitude };
  const loc = await resolveStorePickupLocation(store);
  if (loc) return { storeLat: loc.latitude, storeLong: loc.longitude };
  return { storeLat: null, storeLong: null };
}

module.exports = {
  parseLatLongFromGoogleMapsUrl,
  resolveFinalMapsUrl,
  resolveStorePickupLocation,
  resolveStoreCoordsForDriverMatching,
};
