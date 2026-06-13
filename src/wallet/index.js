'use strict';

const { isUserDeleted } = require('../utils/appUserLifecycle');
const {
  ensureTopupsTable,
  createTopupRecord,
  assertUserCanTopUp,
  roundJod: roundTopupJod,
  completeTopupPayment,
  findTopupByTranRef,
} = require('./topups');

function ensureWalletTables(db) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN walletBalanceJod REAL DEFAULT 0`);
  } catch (e) {
    /* exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phoneNumber TEXT NOT NULL,
      userId TEXT,
      type TEXT NOT NULL,
      amountJod REAL NOT NULL,
      balanceAfterJod REAL,
      orderId INTEGER,
      paymentTranRef TEXT,
      note TEXT,
      createdByAdminId INTEGER,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wallet_tx_phone ON wallet_transactions(phoneNumber, createdAt DESC)`);
  } catch (e) {
    /* ignore */
  }
}

function roundJod(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getWalletBalance(db, phoneNumber) {
  const row = db.prepare('SELECT walletBalanceJod FROM users WHERE phoneNumber = ?').get(phoneNumber);
  return roundJod(row?.walletBalanceJod ?? 0);
}

function mapWalletTransaction(row) {
  return {
    id: row.id,
    type: row.type,
    amountJod: roundJod(row.amountJod),
    balanceAfterJod: row.balanceAfterJod != null ? roundJod(row.balanceAfterJod) : null,
    orderId: row.orderId != null ? row.orderId : null,
    paymentTranRef: row.paymentTranRef || null,
    note: row.note || null,
    createdAt: row.createdAt,
  };
}

function listWalletTransactions(db, phoneNumber, { page = 1, perPage = 20 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePerPage = Math.min(50, Math.max(1, parseInt(perPage, 10) || 20));
  const offset = (safePage - 1) * safePerPage;
  let rows = [];
  let total = 0;
  try {
    rows = db
      .prepare(
        `SELECT id, type, amountJod, balanceAfterJod, orderId, paymentTranRef, note, createdAt
         FROM wallet_transactions
         WHERE phoneNumber = ?
         ORDER BY datetime(createdAt) DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(phoneNumber, safePerPage, offset);
    total = db.prepare('SELECT COUNT(*) AS c FROM wallet_transactions WHERE phoneNumber = ?').get(phoneNumber)?.c ?? 0;
  } catch (e) {
    if (!String(e.message || '').includes('no such table')) throw e;
  }
  return {
    transactions: rows.map(mapWalletTransaction),
    page: safePage,
    perPage: safePerPage,
    total,
  };
}

function creditWallet(db, { phoneNumber, userId, amountJod, type, note, orderId, paymentTranRef, createdByAdminId }) {
  const amount = roundJod(amountJod);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('amountJod must be a positive number');
    err.code = 'VALIDATION';
    throw err;
  }
  const user = db.prepare('SELECT phoneNumber, userId, deleted FROM users WHERE phoneNumber = ?').get(phoneNumber);
  if (!user || isUserDeleted(user)) {
    const err = new Error('User not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const insertTx = db.prepare(`
    INSERT INTO wallet_transactions (phoneNumber, userId, type, amountJod, balanceAfterJod, orderId, paymentTranRef, note, createdByAdminId)
    VALUES (@phoneNumber, @userId, @type, @amountJod, @balanceAfterJod, @orderId, @paymentTranRef, @note, @createdByAdminId)
  `);
  const updateBalance = db.prepare(
    `UPDATE users SET walletBalanceJod = ROUND(COALESCE(walletBalanceJod, 0) + @delta, 2) WHERE phoneNumber = @phoneNumber`,
  );
  const credit = db.transaction(() => {
    updateBalance.run({ phoneNumber, delta: amount });
    const balanceAfterJod = getWalletBalance(db, phoneNumber);
    const info = insertTx.run({
      phoneNumber,
      userId: userId || user.userId || phoneNumber,
      type,
      amountJod: amount,
      balanceAfterJod,
      orderId: orderId ?? null,
      paymentTranRef: paymentTranRef ?? null,
      note: note ?? null,
      createdByAdminId: createdByAdminId ?? null,
    });
    return { balanceJod: balanceAfterJod, transactionId: info.lastInsertRowid };
  });
  return credit();
}

function debitWallet(db, { phoneNumber, userId, amountJod, type, note, orderId }) {
  const amount = roundJod(amountJod);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('amountJod must be a positive number');
    err.code = 'VALIDATION';
    throw err;
  }
  const user = db.prepare('SELECT phoneNumber, userId, walletBalanceJod, deleted FROM users WHERE phoneNumber = ?').get(phoneNumber);
  if (!user || isUserDeleted(user)) {
    const err = new Error('User not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const current = roundJod(user.walletBalanceJod ?? 0);
  if (current < amount) {
    const err = new Error('Insufficient wallet balance');
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }
  const insertTx = db.prepare(`
    INSERT INTO wallet_transactions (phoneNumber, userId, type, amountJod, balanceAfterJod, orderId, paymentTranRef, note, createdByAdminId)
    VALUES (@phoneNumber, @userId, @type, @amountJod, @balanceAfterJod, @orderId, NULL, @note, NULL)
  `);
  const updateBalance = db.prepare(
    `UPDATE users SET walletBalanceJod = ROUND(COALESCE(walletBalanceJod, 0) - @delta, 2) WHERE phoneNumber = @phoneNumber`,
  );
  const debit = db.transaction(() => {
    updateBalance.run({ phoneNumber, delta: amount });
    const balanceAfterJod = getWalletBalance(db, phoneNumber);
    const info = insertTx.run({
      phoneNumber,
      userId: userId || user.userId || phoneNumber,
      type,
      amountJod: -amount,
      balanceAfterJod,
      orderId: orderId ?? null,
      note: note ?? null,
    });
    return { balanceJod: balanceAfterJod, transactionId: info.lastInsertRowid };
  });
  return debit();
}

module.exports = function attachWalletRoutes(app, db, authenticateRequest) {
  ensureWalletTables(db);
  ensureTopupsTable(db);

  app.post('/api/wallet/top-up/cliq', authenticateRequest, (req, res) => {
    try {
      const body = req.body || {};
      const amountJod = body.amountJod ?? body.amount;
      const paymentVerificationImage = body.paymentVerificationImage;
      if (paymentVerificationImage == null || String(paymentVerificationImage).trim() === '') {
        return res.status(400).json({ success: false, message: 'paymentVerificationImage is required for Cliq top-up' });
      }
      const amount = roundTopupJod(amountJod);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'amountJod must be a positive number' });
      }
      const user = assertUserCanTopUp(db, req.user.phoneNumber);
      const topup = createTopupRecord(db, {
        phoneNumber: user.phoneNumber,
        userId: user.userId,
        amountJod: amount,
        paymentMethod: 'cliq',
        status: 'waiting_cliq_confirmation',
        cartId: `WALLET-TOPUP-CLIQ-${Date.now()}`,
        paymentVerificationImage: String(paymentVerificationImage).trim(),
        note: body.note ? String(body.note).trim() : null,
      });
      return res.status(201).json({
        success: true,
        message: 'Top-up submitted; awaiting Cliq confirmation',
        data: { topup: require('./topups').mapTopupRow(topup) },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ success: false, message: error.message });
      }
      console.error('POST /api/wallet/top-up/cliq error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/wallet', authenticateRequest, (req, res) => {
    try {
      const phoneNumber = req.user.phoneNumber;
      const page = req.query.page;
      const perPage = req.query.perPage;
      const balanceJod = getWalletBalance(db, phoneNumber);
      const { transactions, page: p, perPage: pp, total } = listWalletTransactions(db, phoneNumber, {
        page,
        perPage,
      });
      return res.status(200).json({
        success: true,
        message: 'Wallet retrieved successfully',
        data: {
          wallet: {
            balanceJod,
            currency: 'JOD',
            transactions,
            page: p,
            perPage: pp,
            total,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('GET /api/wallet error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
};

module.exports.ensureWalletTables = ensureWalletTables;
module.exports.getWalletBalance = getWalletBalance;
module.exports.listWalletTransactions = listWalletTransactions;
module.exports.creditWallet = creditWallet;
module.exports.debitWallet = debitWallet;
module.exports.mapWalletTransaction = mapWalletTransaction;
module.exports.ensureTopupsTable = ensureTopupsTable;
module.exports.completeTopupPayment = completeTopupPayment;
module.exports.findTopupByTranRef = findTopupByTranRef;
