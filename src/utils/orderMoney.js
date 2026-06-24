'use strict';

function round2Money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function safeMoney(v, fallback = 0) {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function sumOrderItemsSubtotal(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const raw = items.reduce(
    (sum, i) => sum + safeMoney(i.price, 0) * safeMoney(i.quantity, 1),
    0,
  );
  return round2Money(raw);
}

function loadItemsSubtotalFromDb(db, orderId) {
  if (!db || orderId == null) return null;
  try {
    const row = db
      .prepare('SELECT COALESCE(SUM(price * quantity), 0) AS subtotal FROM order_items WHERE orderId = ?')
      .get(orderId);
    const sub = row?.subtotal != null ? Number(row.subtotal) : 0;
    return Number.isFinite(sub) && sub > 0 ? round2Money(sub) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve store-order items subtotal (before delivery/service/tax).
 * Prefer line items; DB `totalAmount` should be items-only but legacy rows may store client grand total.
 */
function resolveStoreOrderItemsSubtotal(row, options = {}) {
  const discount = safeMoney(row?.discount, 0);
  const applyDiscount = (subtotal) => round2Money(Math.max(0, subtotal - discount));

  const fromItems = sumOrderItemsSubtotal(options.items);
  if (fromItems != null) return applyDiscount(fromItems);

  const fromDbItems = loadItemsSubtotalFromDb(options.db, row?.id);
  if (fromDbItems != null) return applyDiscount(fromDbItems);

  const dbTotal = safeMoney(row?.totalAmount, 0);
  const deliveryFee = safeMoney(row?.deliveryFee, 0);
  const serviceFee = safeMoney(row?.serviceFee, 0);
  const feesTax = safeMoney(row?.feesTax, 0);
  const feesSum = round2Money(deliveryFee + serviceFee + feesTax);

  if (feesSum > 0) {
    const asItemsOnly = round2Money(dbTotal - feesSum);
    if (asItemsOnly >= 0 && Math.abs(dbTotal - (asItemsOnly + feesSum)) < 0.02) {
      return asItemsOnly;
    }
  }

  return round2Money(dbTotal);
}

/** Store order: customer-facing `totalAmount` is grand total (items + fees). */
function storeOrderMoneyFields(row, options = {}) {
  const deliveryFee = safeMoney(row.deliveryFee, 0);
  const serviceFee = safeMoney(row.serviceFee, 0);
  const feesTax = safeMoney(row.feesTax, 0);
  const feesTotal = round2Money(deliveryFee + serviceFee + feesTax);
  const itemsSubtotal = resolveStoreOrderItemsSubtotal(row, options);
  const totalAmount = round2Money(itemsSubtotal + feesTotal);
  return { totalAmount, itemsSubtotal, deliveryFee, serviceFee, feesTax, feesTotal };
}

/**
 * Arheb Box money. `amount` is the parcel's declared value (shown separately as `itemsSubtotal`),
 * NOT an extra charge. The payable total is the delivery + service + tax fees ONLY — this matches
 * what the customer agrees to in the quote (POST /api/arheb-box/quote → invoice.total = fees only).
 * The parcel value must never be added on top, or the customer/driver/dashboard all show double
 * (e.g. #122: parcel 1.75 + fees 1.75 was wrongly shown as 3.50).
 */
function arhebBoxOrderMoneyFields(row) {
  const itemsSubtotal = safeMoney(row.amount, 0);
  const deliveryFee = safeMoney(row.deliveryFee, 0);
  const serviceFee = safeMoney(row.serviceFee, 0);
  const feesTax = safeMoney(row.feesTax, 0);
  const feesTotal = round2Money(deliveryFee + serviceFee + feesTax);
  const totalAmount = feesTotal;
  return { totalAmount, itemsSubtotal, deliveryFee, serviceFee, feesTax, feesTotal };
}

module.exports = {
  round2Money,
  safeMoney,
  sumOrderItemsSubtotal,
  resolveStoreOrderItemsSubtotal,
  storeOrderMoneyFields,
  arhebBoxOrderMoneyFields,
};
