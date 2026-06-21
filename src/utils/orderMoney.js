'use strict';

function round2Money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function safeMoney(v, fallback = 0) {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/** Store order: DB `totalAmount` is items subtotal; customer-facing total adds fees. */
function storeOrderMoneyFields(row) {
  const itemsSubtotal = safeMoney(row.totalAmount, 0);
  const deliveryFee = safeMoney(row.deliveryFee, 0);
  const serviceFee = safeMoney(row.serviceFee, 0);
  const feesTax = safeMoney(row.feesTax, 0);
  const totalAmount = round2Money(itemsSubtotal + deliveryFee + serviceFee + feesTax);
  return { totalAmount, itemsSubtotal, deliveryFee, serviceFee, feesTax };
}

/** Arheb Box: `amount` is parcel/declared value; total adds delivery, service, tax. */
function arhebBoxOrderMoneyFields(row) {
  const itemsSubtotal = safeMoney(row.amount, 0);
  const deliveryFee = safeMoney(row.deliveryFee, 0);
  const serviceFee = safeMoney(row.serviceFee, 0);
  const feesTax = safeMoney(row.feesTax, 0);
  const totalAmount = round2Money(itemsSubtotal + deliveryFee + serviceFee + feesTax);
  return { totalAmount, itemsSubtotal, deliveryFee, serviceFee, feesTax };
}

module.exports = {
  round2Money,
  safeMoney,
  storeOrderMoneyFields,
  arhebBoxOrderMoneyFields,
};
