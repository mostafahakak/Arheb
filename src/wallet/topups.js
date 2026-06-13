'use strict';

const { isUserDeleted } = require('../utils/appUserLifecycle');

function ensureTopupsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phoneNumber TEXT NOT NULL,
      userId TEXT,
      amountJod REAL NOT NULL,
      currency TEXT DEFAULT 'JOD',
      paymentMethod TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      tranRef TEXT,
      cartId TEXT,
      redirectUrl TEXT,
      paymentVerificationImage TEXT,
      walletTransactionId INTEGER,
      paymentTransactionId INTEGER,
      responseStatus TEXT,
      responseMessage TEXT,
      rawResponse TEXT,
      note TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      completedAt TEXT
    )
  `);
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_cartId ON topups(cartId) WHERE cartId IS NOT NULL`);
  } catch (e) {
    /* ignore */
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_topups_phone ON topups(phoneNumber, createdAt DESC)`);
  } catch (e) {
    /* ignore */
  }
  try {
    db.exec('ALTER TABLE payment_transactions ADD COLUMN topupId INTEGER');
  } catch (e) {
    /* exists */
  }
}

function roundJod(n) {
  return Math.round(Number(n) * 100) / 100;
}

function mapTopupRow(row, userName) {
  if (!row) return null;
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    userId: row.userId || null,
    userName: userName || null,
    amountJod: roundJod(row.amountJod),
    currency: row.currency || 'JOD',
    paymentMethod: row.paymentMethod,
    status: row.status,
    tranRef: row.tranRef || null,
    cartId: row.cartId || null,
    redirectUrl: row.redirectUrl || null,
    paymentVerificationImage: row.paymentVerificationImage || null,
    walletTransactionId: row.walletTransactionId ?? null,
    paymentTransactionId: row.paymentTransactionId ?? null,
    responseStatus: row.responseStatus || null,
    responseMessage: row.responseMessage || null,
    note: row.note || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt || null,
  };
}

function createTopupRecord(db, {
  phoneNumber,
  userId,
  amountJod,
  paymentMethod,
  status,
  cartId,
  tranRef,
  redirectUrl,
  paymentVerificationImage,
  paymentTransactionId,
  rawResponse,
  note,
}) {
  const info = db.prepare(`
    INSERT INTO topups (
      phoneNumber, userId, amountJod, currency, paymentMethod, status, cartId, tranRef,
      redirectUrl, paymentVerificationImage, paymentTransactionId, rawResponse, note
    ) VALUES (?, ?, ?, 'JOD', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    phoneNumber,
    userId || phoneNumber,
    roundJod(amountJod),
    paymentMethod,
    status,
    cartId || null,
    tranRef || null,
    redirectUrl || null,
    paymentVerificationImage || null,
    paymentTransactionId ?? null,
    rawResponse ? JSON.stringify(rawResponse) : null,
    note || null,
  );
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(info.lastInsertRowid);
}

function findTopupByTranRef(db, tranRef) {
  if (!tranRef) return null;
  return db.prepare('SELECT * FROM topups WHERE tranRef = ?').get(tranRef);
}

function findTopupById(db, id) {
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(id);
}

function completeTopupPayment(db, topupId, { tranRef, responseStatus, responseMessage, rawResponse } = {}) {
  const topup = findTopupById(db, topupId);
  if (!topup) return { ok: false, code: 'NOT_FOUND', message: 'Top-up not found' };
  if (topup.status === 'completed') {
    return { ok: true, alreadyCompleted: true, topup: mapTopupRow(topup) };
  }

  const finalize = db.transaction(() => {
    const locked = db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId);
    if (!locked || locked.status === 'completed') {
      return { ok: true, alreadyCompleted: true, topup: mapTopupRow(locked) };
    }

    const { creditWallet } = require('./index');
    const walletType = String(locked.paymentMethod).toLowerCase() === 'cliq' ? 'top_up_cliq' : 'top_up_card';
    const credit = creditWallet(db, {
      phoneNumber: locked.phoneNumber,
      userId: locked.userId,
      amountJod: locked.amountJod,
      type: walletType,
      paymentTranRef: tranRef || locked.tranRef || null,
      note: locked.note || `Wallet top-up #${locked.id}`,
    });

    db.prepare(`
      UPDATE topups SET
        status = 'completed',
        tranRef = COALESCE(?, tranRef),
        walletTransactionId = ?,
        responseStatus = COALESCE(?, responseStatus),
        responseMessage = COALESCE(?, responseMessage),
        rawResponse = COALESCE(?, rawResponse),
        updatedAt = CURRENT_TIMESTAMP,
        completedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      tranRef || null,
      credit.transactionId,
      responseStatus || null,
      responseMessage || null,
      rawResponse ? JSON.stringify(rawResponse) : null,
      topupId,
    );

    const updated = findTopupById(db, topupId);
    return { ok: true, topup: mapTopupRow(updated), balanceJod: credit.balanceJod };
  });

  return finalize();
}

function listTopups(db, { phoneNumber, status, paymentMethod, dateFrom, dateTo, page = 1, perPage = 20 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePerPage = Math.min(100, Math.max(1, parseInt(perPage, 10) || 20));
  const offset = (safePage - 1) * safePerPage;
  const where = ['1=1'];
  const params = [];

  if (phoneNumber) {
    where.push('t.phoneNumber = ?');
    params.push(phoneNumber);
  }
  if (status) {
    where.push('t.status = ?');
    params.push(String(status));
  }
  if (paymentMethod) {
    where.push('LOWER(t.paymentMethod) = ?');
    params.push(String(paymentMethod).toLowerCase());
  }
  if (dateFrom) {
    where.push('date(t.createdAt) >= date(?)');
    params.push(String(dateFrom).slice(0, 10));
  }
  if (dateTo) {
    where.push('date(t.createdAt) <= date(?)');
    params.push(String(dateTo).slice(0, 10));
  }

  const whereSql = where.join(' AND ');
  const total =
    db.prepare(`SELECT COUNT(*) AS c FROM topups t WHERE ${whereSql}`).get(...params)?.c ?? 0;
  const rows = db
    .prepare(
      `SELECT t.*, u.name AS userName
       FROM topups t
       LEFT JOIN users u ON u.phoneNumber = t.phoneNumber
       WHERE ${whereSql}
       ORDER BY datetime(t.createdAt) DESC, t.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, safePerPage, offset);

  return {
    topups: rows.map((r) => mapTopupRow(r, r.userName)),
    page: safePage,
    perPage: safePerPage,
    total,
  };
}

function approveCliqTopup(db, topupId, adminId) {
  const topup = findTopupById(db, topupId);
  if (!topup) return { ok: false, statusCode: 404, message: 'Top-up not found' };
  if (topup.status !== 'waiting_cliq_confirmation') {
    return { ok: false, statusCode: 400, message: 'Top-up is not awaiting Cliq confirmation' };
  }
  const result = completeTopupPayment(db, topupId, {
    responseStatus: 'A',
    responseMessage: 'Approved by admin',
  });
  if (!result.ok) return { ok: false, statusCode: 500, message: 'Failed to complete top-up' };
  return { ok: true, data: result };
}

function rejectCliqTopup(db, topupId, note) {
  const topup = findTopupById(db, topupId);
  if (!topup) return { ok: false, statusCode: 404, message: 'Top-up not found' };
  if (topup.status !== 'waiting_cliq_confirmation') {
    return { ok: false, statusCode: 400, message: 'Top-up is not awaiting Cliq confirmation' };
  }
  db.prepare(`
    UPDATE topups SET status = 'rejected', note = COALESCE(?, note), updatedAt = CURRENT_TIMESTAMP WHERE id = ?
  `).run(note || 'Rejected by admin', topupId);
  return { ok: true, topup: mapTopupRow(findTopupById(db, topupId)) };
}

function assertUserCanTopUp(db, phoneNumber) {
  const user = db.prepare('SELECT phoneNumber, userId, deleted FROM users WHERE phoneNumber = ?').get(phoneNumber);
  if (!user || isUserDeleted(user)) {
    const err = new Error('User not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return user;
}

module.exports = {
  ensureTopupsTable,
  mapTopupRow,
  createTopupRecord,
  findTopupByTranRef,
  findTopupById,
  completeTopupPayment,
  listTopups,
  approveCliqTopup,
  rejectCliqTopup,
  assertUserCanTopUp,
  roundJod,
};
