'use strict';

const { getWalletBalance, debitWallet } = require('./index');
const {
  isPaymentTypeAllowedForStore,
  paymentMethodRejectedUserMessage,
} = require('../utils/storePaymentMethods');

function roundJod(n) {
  return Math.round(Number(n) * 100) / 100;
}

function computeCheckoutGrandTotalJod(totalAmount, deliveryFee, serviceFee, feesTax) {
  return roundJod(
    Number(totalAmount || 0) + Number(deliveryFee || 0) + Number(serviceFee || 0) + Number(feesTax || 0),
  );
}

function normalizeCheckoutPaymentType(paymentType) {
  return String(paymentType || '').trim().toLowerCase();
}

function resolveWalletCheckoutPlan({
  paymentType,
  walletAmountJod,
  grandTotalJod,
  walletBalanceJod,
  storeJson,
  addressLat,
  addressLong,
}) {
  const walletRequested = roundJod(walletAmountJod || 0);
  const grandTotal = roundJod(grandTotalJod);
  const balance = roundJod(walletBalanceJod);

  if (walletRequested <= 0) {
    return { ok: true, walletAmountJod: 0, remainderJod: grandTotal, paymentType: normalizeCheckoutPaymentType(paymentType) };
  }

  if (walletRequested > balance) {
    return { ok: false, statusCode: 400, message: 'Insufficient wallet balance' };
  }
  if (walletRequested > grandTotal) {
    return { ok: false, statusCode: 400, message: 'walletAmountJod cannot exceed order total' };
  }

  const remainder = roundJod(grandTotal - walletRequested);
  let pt = normalizeCheckoutPaymentType(paymentType);

  if (remainder <= 0) {
    if (pt && pt !== 'wallet') {
      return { ok: false, statusCode: 400, message: 'Use paymentType Wallet when wallet covers the full order total' };
    }
    return {
      ok: true,
      walletAmountJod: walletRequested,
      remainderJod: 0,
      paymentType: 'wallet',
    };
  }

  if (pt === 'cash' || pt === 'cod') {
    return {
      ok: false,
      statusCode: 400,
      message: 'Cash on delivery is not allowed when paying partly from wallet. Use Card or Cliq for the remainder.',
    };
  }

  if (pt === 'card') pt = 'wallet+card';
  if (pt === 'cliq') pt = 'wallet+cliq';

  if (pt !== 'wallet+card' && pt !== 'wallet+cliq') {
    return {
      ok: false,
      statusCode: 400,
      message: 'When paying partly from wallet, set paymentType to Wallet+Card or Wallet+Cliq (or Card/Cliq with walletAmountJod).',
    };
  }

  const remainderKey = pt === 'wallet+card' ? 'card' : 'cliq';
  if (
    storeJson &&
    !isPaymentTypeAllowedForStore(storeJson, remainderKey, addressLat, addressLong)
  ) {
    return {
      ok: false,
      statusCode: 400,
      message: paymentMethodRejectedUserMessage(remainderKey, addressLat, addressLong),
    };
  }

  return {
    ok: true,
    walletAmountJod: walletRequested,
    remainderJod: remainder,
    paymentType: pt,
  };
}

function applyWalletDebitForOrder(db, { phoneNumber, userId, walletAmountJod, orderId }) {
  const amount = roundJod(walletAmountJod);
  if (amount <= 0) return { ok: true, skipped: true };
  try {
    const result = debitWallet(db, {
      phoneNumber,
      userId,
      amountJod: amount,
      type: 'order_debit',
      orderId,
      note: `Order #${orderId}`,
    });
    return { ok: true, ...result };
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE') {
      return { ok: false, statusCode: 400, message: e.message };
    }
    throw e;
  }
}

module.exports = {
  computeCheckoutGrandTotalJod,
  resolveWalletCheckoutPlan,
  applyWalletDebitForOrder,
  getWalletBalance,
};
