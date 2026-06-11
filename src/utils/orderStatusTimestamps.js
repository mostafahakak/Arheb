const ORDER_STATUS_TIMESTAMP_COLUMNS = [
  'preparingAt',
  'onTheWayAt',
  'deliveredAt',
  'waitingConfirmationAt',
  'storeArhebFeePercent',
];

function ensureOrderStatusTimestampColumns(db) {
  for (const col of ORDER_STATUS_TIMESTAMP_COLUMNS) {
    try {
      if (col === 'storeArhebFeePercent') {
        db.exec('ALTER TABLE orders ADD COLUMN storeArhebFeePercent REAL');
      } else {
        db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT`);
      }
    } catch (e) {
      /* exists */
    }
  }
}

function normalizeOrderStatusKey(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function statusTimestampColumnFor(nextStatus) {
  const key = normalizeOrderStatusKey(nextStatus);
  if (key === 'preparing' || key === 'being prepared') return 'preparingAt';
  if (key === 'on the way') return 'onTheWayAt';
  if (key === 'delivered') return 'deliveredAt';
  if (key === 'waiting confirmation') return 'waitingConfirmationAt';
  return null;
}

/** Record first transition into each phase (COALESCE keeps earliest timestamp). */
function recordOrderStatusTimestamp(db, orderId, nextStatus) {
  const col = statusTimestampColumnFor(nextStatus);
  if (!col) return;
  const now = new Date().toISOString();
  db.prepare(`UPDATE orders SET ${col} = COALESCE(${col}, ?) WHERE id = ?`).run(now, orderId);
}

module.exports = {
  ensureOrderStatusTimestampColumns,
  normalizeOrderStatusKey,
  statusTimestampColumnFor,
  recordOrderStatusTimestamp,
};
