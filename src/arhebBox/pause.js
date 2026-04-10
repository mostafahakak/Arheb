function envTruthy(name) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * When true, new Arheb Box quotes, cash/other submissions, and card initiate are rejected (503).
 * Existing requests (GET, driver, admin) still work. Payment callbacks that already completed use
 * createArhebBoxRequest(..., { allowWhenPaused: true }) so the customer is not stranded.
 *
 * Set env: ARHEB_BOX_PAUSED=true (or 1 / yes). Unset or false = normal operation.
 */
function isArhebBoxOrdersPaused() {
  return envTruthy('ARHEB_BOX_PAUSED');
}

module.exports = { isArhebBoxOrdersPaused };
