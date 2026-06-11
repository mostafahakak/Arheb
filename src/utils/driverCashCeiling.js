const { orderGrandTotalJod, isCashPaymentType } = require('./orderAdminMetrics');

function ensureDriverCashCeilingColumns(db) {
  try {
    db.exec('ALTER TABLE drivers ADD COLUMN cashCeilingJod REAL');
  } catch (e) {
    /* exists */
  }
  try {
    db.exec('ALTER TABLE drivers ADD COLUMN cashCollectedJod REAL DEFAULT 0');
  } catch (e) {
    /* exists */
  }
}

function getDriverCashState(db, driverId) {
  const row = db
    .prepare('SELECT cashCeilingJod, cashCollectedJod FROM drivers WHERE id = ?')
    .get(driverId);
  if (!row) return null;
  const ceiling = row.cashCeilingJod != null && Number.isFinite(Number(row.cashCeilingJod)) ? Number(row.cashCeilingJod) : null;
  const collected = Number(row.cashCollectedJod) || 0;
  return { ceiling, collected, remaining: ceiling != null ? Math.max(0, ceiling - collected) : null };
}

function driverCanAcceptCashOrder(db, driverId, cashAmountJod) {
  const state = getDriverCashState(db, driverId);
  if (!state || state.ceiling == null) return { ok: true, state };
  const add = Number(cashAmountJod) || 0;
  if (add <= 0) return { ok: true, state };
  if (state.collected + add <= state.ceiling + 0.001) return { ok: true, state };
  return {
    ok: false,
    state,
    message: `Driver cash ceiling reached (${state.collected.toFixed(2)} / ${state.ceiling.toFixed(2)} JOD). Reset after deposit or assign card/Cliq orders only.`,
  };
}

function driverCanAcceptCashOrderRow(db, driverId, order) {
  if (!isCashPaymentType(order?.paymentType)) return { ok: true };
  return driverCanAcceptCashOrder(db, driverId, orderGrandTotalJod(order));
}

function addDriverCashCollected(db, driverId, amountJod) {
  const add = Number(amountJod) || 0;
  if (add <= 0) return;
  db.prepare('UPDATE drivers SET cashCollectedJod = COALESCE(cashCollectedJod, 0) + ? WHERE id = ?').run(add, driverId);
}

function resetDriverCashCollected(db, driverId) {
  db.prepare('UPDATE drivers SET cashCollectedJod = 0 WHERE id = ?').run(driverId);
}

module.exports = {
  ensureDriverCashCeilingColumns,
  getDriverCashState,
  driverCanAcceptCashOrder,
  driverCanAcceptCashOrderRow,
  addDriverCashCollected,
  resetDriverCashCollected,
};
