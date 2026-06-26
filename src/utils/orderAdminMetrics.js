const { round2: round2Money } = require('./deliveryFees');

function round2(n) {
  return round2Money(n);
}

function isCashPaymentType(paymentType) {
  const p = String(paymentType ?? '')
    .trim()
    .toLowerCase();
  return p === 'cash' || p === 'cod';
}

/** Store order: DB `totalAmount` is items subtotal. Arheb Box: use parcel `amount` when present on enriched row. */
function orderItemsSubtotalJod(order) {
  if (!order) return 0;
  if (order.orderType === 'arheb_box') {
    const a = order.amount != null ? Number(order.amount) : Number(order.totalAmount ?? 0);
    return Number.isFinite(a) ? round2(a) : 0;
  }
  const items = order.items;
  if (Array.isArray(items) && items.length > 0) {
    const raw = items.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0);
    if (raw > 0) return round2(raw);
  }
  const ta = Number(order.totalAmount ?? 0);
  return Number.isFinite(ta) ? round2(ta) : 0;
}

function orderGrandTotalJod(order) {
  if (!order) return 0;
  if (order.orderType === 'arheb_box') {
    // Arheb Box payable total = parcel amount + delivery + service + tax.
    const amount = order.amount != null ? Number(order.amount) : Number(order.itemsSubtotal ?? 0);
    const d = Number(order.deliveryFee ?? order.invoice?.deliveryFee ?? 0) || 0;
    const s = Number(order.serviceFee ?? order.invoice?.serviceFee ?? 0) || 0;
    const ft = Number(order.feesTax ?? order.invoice?.feesTax ?? 0) || 0;
    if (Number.isFinite(amount) && amount >= 0) {
      return round2(amount + d + s + ft);
    }
    const inv = Number(order.invoice?.total);
    if (Number.isFinite(inv)) return round2(inv);
    return round2(d + s + ft);
  }
  const items = orderItemsSubtotalJod(order);
  const d = Number(order.deliveryFee) || 0;
  const s = Number(order.serviceFee) || 0;
  const ft = Number(order.feesTax) || 0;
  return round2(items + d + s + ft);
}

/**
 * Prefer frozen snapshot on the order row; fall back to live store JSON only when snapshot missing (legacy orders).
 */
function resolveStoreArhebFeePercent(order, storeById) {
  if (!order || order.orderType === 'arheb_box') return null;
  const snap = order.storeArhebFeePercent;
  if (snap != null && snap !== '' && Number.isFinite(Number(snap))) {
    const n = Number(snap);
    return n >= 0 ? n : null;
  }
  const sid = order.storeId != null ? String(order.storeId) : '';
  const store = sid && storeById ? storeById[sid] : null;
  const live = store?.arhebFee;
  if (live != null && live !== '' && Number.isFinite(Number(live))) {
    const n = Number(live);
    return n >= 0 ? n : null;
  }
  return null;
}

function orderRestaurantMetrics(order, storeById) {
  const items = orderItemsSubtotalJod(order);
  const pct = resolveStoreArhebFeePercent(order, storeById);
  const resValue = pct != null && pct > 0 ? round2((items * pct) / 100) : pct === 0 ? 0 : null;
  return {
    itemsSubtotalJod: items,
    restaurantSalesBeforeFeeJod: items,
    storeArhebFeePercent: pct,
    restaurantResPercent: pct,
    restaurantResValueJod: resValue,
    restaurantNetAfterArhebJod: resValue != null ? round2(items - resValue) : items,
  };
}

function parseIsoMs(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function minutesBetween(startIso, endIso) {
  const a = parseIsoMs(startIso);
  const b = parseIsoMs(endIso);
  if (a == null || b == null || b < a) return null;
  return round2((b - a) / 60000);
}

function orderTimingMetrics(order) {
  return {
    preparationTimeMinutes: minutesBetween(order?.preparingAt, order?.onTheWayAt),
    deliveryTimeMinutes: minutesBetween(order?.onTheWayAt, order?.deliveredAt),
    responseTimeMinutes: minutesBetween(order?.createdAt, order?.waitingConfirmationAt ?? order?.preparingAt),
  };
}

function enrichAdminOrderMetrics(order, storeById) {
  const restaurant = orderRestaurantMetrics(order, storeById);
  const timing = orderTimingMetrics(order);
  const itemsPart = restaurant.itemsSubtotalJod;
  const d = Number(order.deliveryFee) || 0;
  const s = Number(order.serviceFee) || 0;
  const ft = Number(order.feesTax) || 0;
  const driverEarnings = order.driverEarningsJod != null ? Number(order.driverEarningsJod) : null;
  const deliveryNet =
    order.deliveryNetAfterDriverJod != null
      ? Number(order.deliveryNetAfterDriverJod)
      : driverEarnings != null
        ? round2(Math.max(0, d - driverEarnings))
        : null;
  return {
    ...order,
    ...restaurant,
    ...timing,
    grandTotalJod: orderGrandTotalJod(order),
    deliveryNetAfterDriverJod: deliveryNet,
  };
}

module.exports = {
  round2,
  isCashPaymentType,
  orderItemsSubtotalJod,
  orderGrandTotalJod,
  resolveStoreArhebFeePercent,
  orderRestaurantMetrics,
  orderTimingMetrics,
  enrichAdminOrderMetrics,
};
