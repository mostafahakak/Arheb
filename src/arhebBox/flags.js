const { isArhebBoxOrdersPaused, envTruthy } = require('./pause');

function readComingSoonFromDb(db) {
  if (!db) return false;
  try {
    const row = db.prepare('SELECT arhebBoxComingSoon FROM contact_us ORDER BY id DESC LIMIT 1').get();
    if (!row) return false;
    const v = row.arhebBoxComingSoon;
    return v === 1 || v === true;
  } catch (e) {
    if (e.message && (e.message.includes('no such column') || e.message.includes('no such table'))) {
      return false;
    }
    throw e;
  }
}

/**
 * “Coming soon” is driven by the database (`contact_us.arhebBoxComingSoon`, set via
 * PATCH /api/admin/info) or by env `ARHEB_BOX_COMING_SOON=true` (host config, not literals in app code).
 * Env truthy OR db flag truthy ⇒ comingSoon.
 */
function isArhebBoxComingSoon(db) {
  if (envTruthy('ARHEB_BOX_COMING_SOON')) return true;
  return readComingSoonFromDb(db);
}

/** Public shape for mobile apps (e.g. GET /api/contact). */
function getArhebBoxPublicFlags(db) {
  const paused = isArhebBoxOrdersPaused();
  const comingSoon = isArhebBoxComingSoon(db);
  return {
    comingSoon,
    paused,
    acceptingNewOrders: !paused,
  };
}

module.exports = {
  isArhebBoxComingSoon,
  getArhebBoxPublicFlags,
  readComingSoonFromDb,
};
