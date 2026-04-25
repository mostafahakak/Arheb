const EPS = 1e-3; // 0.1 fils tolerance in JOD

function num(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const n = parseFloat(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : NaN;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** True if n is (approximately) a multiple of 0.25 JOD — typical shelf "full" price. */
function isLikePreDiscountJodListPrice(n) {
  if (!Number.isFinite(n) || n <= 0) return false;
  const k = n * 4;
  return Math.abs(k - Math.round(k)) < 1e-2;
}

/**
 * @param {unknown} d discount field (number, "8", "8%")
 * @returns {number | null} percent 0–100, or null if not a positive discount
 */
function parseDiscountPercent(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'number') {
    if (!Number.isFinite(d) || d <= 0 || d > 100) return null;
    return d;
  }
  const n = parseFloat(String(d).replace(/%/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return n;
}

/**
 * For JSON-backed products: when a % discount is set, the sale `price` should be
 * preDiscount × (1 - discount/100). Bulk discount often only sets `discount` and
 * leaves `price` at the pre-discount amount, so the API would show the same
 * `price` and `originalPrice`. This resolves consistent sale vs strike-through amounts.
 *
 * @returns {{ price: number, originalPrice: number }}
 */
function applyCatalogListPriceAndOriginal(p) {
  const list = num(p && p.price);
  const listOk = Number.isFinite(list);
  const origIn = p && p.originalPrice;
  const origN = num(origIn);
  const hasOrig = origIn != null && origIn !== '' && Number.isFinite(origN) && origN > 0;
  const discPct = parseDiscountPercent(p && p.discount);

  if (discPct == null) {
    const price = listOk ? list : 0;
    const originalPrice = hasOrig ? origN : price;
    return { price, originalPrice };
  }

  if (!listOk) {
    const o = hasOrig ? origN : 0;
    return { price: hasOrig ? round2(o * (1 - discPct / 100)) : 0, originalPrice: o };
  }

  if (hasOrig) {
    const sale = round2(origN * (1 - discPct / 100));
    if (Math.abs(list - origN) <= EPS) {
      return { price: sale, originalPrice: origN };
    }
    if (Math.abs(list - sale) <= EPS) {
      return { price: list, originalPrice: origN };
    }
    return { price: list, originalPrice: origN };
  }

  // No originalPrice: bulk discount often only sets `discount`, leaving `price` at the
  // pre-discount amount (0.25-step JOD), OR only the final sale (e.g. 0.69) is stored.
  if (isLikePreDiscountJodListPrice(list)) {
    return { price: round2(list * (1 - discPct / 100)), originalPrice: list };
  }
  const invFull = round2(list / (1 - discPct / 100));
  const fromInv = round2(invFull * (1 - discPct / 100));
  if (invFull > list + EPS && Math.abs(list - fromInv) <= EPS) {
    return { price: list, originalPrice: invFull };
  }
  return { price: round2(list * (1 - discPct / 100)), originalPrice: list };
}

module.exports = {
  applyCatalogListPriceAndOriginal,
  parseDiscountPercent,
};
