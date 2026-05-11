/**
 * Product add-on groups (JSON on product) + checkout validation for selectedAddOns.
 */

function sanitizeAddOnGroups(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((g) => {
      if (!g || typeof g !== 'object') return null;
      const id = String(g.id ?? '').trim();
      if (!id) return null;
      const options = Array.isArray(g.options)
        ? g.options
            .map((o) => {
              if (!o || typeof o !== 'object') return null;
              const oid = String(o.id ?? '').trim();
              if (!oid) return null;
              const base = {
                id: oid,
                name: o.name != null ? String(o.name) : '',
                nameAr: o.nameAr != null ? String(o.nameAr) : '',
                nameEn: o.nameEn != null ? String(o.nameEn) : '',
              };
              const ap = o.additionalPrice;
              const pr = o.price;
              if (typeof ap === 'number' && !Number.isNaN(ap)) base.additionalPrice = ap;
              else if (typeof pr === 'number' && !Number.isNaN(pr)) base.price = pr;
              return base;
            })
            .filter(Boolean)
        : [];
      return {
        id,
        name: g.name != null ? String(g.name) : '',
        nameAr: g.nameAr != null ? String(g.nameAr) : '',
        nameEn: g.nameEn != null ? String(g.nameEn) : '',
        required: Boolean(g.required),
        options,
      };
    })
    .filter(Boolean);
}

/**
 * @returns {{ ok: boolean, message?: string, normalized?: Record<string, string> }}
 */
function validateSelectedAddOnsAgainstProduct(product, selectedRaw) {
  const groups = Array.isArray(product?.addOnGroups) ? product.addOnGroups : [];
  if (groups.length === 0) {
    if (selectedRaw != null && typeof selectedRaw === 'object' && !Array.isArray(selectedRaw) && Object.keys(selectedRaw).length > 0) {
      return { ok: false, message: 'This product has no add-on groups' };
    }
    return { ok: true, normalized: {} };
  }
  if (selectedRaw == null || selectedRaw === '') {
    if (groups.some((g) => g.required)) {
      return { ok: false, message: 'selectedAddOns is required for one or more add-on groups' };
    }
    return { ok: true, normalized: {} };
  }
  if (typeof selectedRaw !== 'object' || Array.isArray(selectedRaw)) {
    return { ok: false, message: 'selectedAddOns must be an object' };
  }
  const normalized = {};
  const groupIds = new Set(groups.map((g) => g.id));
  for (const key of Object.keys(selectedRaw)) {
    if (!groupIds.has(key)) {
      return { ok: false, message: `Unknown add-on group: ${key}` };
    }
  }
  for (const g of groups) {
    const val = selectedRaw[g.id];
    const hasVal = val != null && val !== '';
    if (g.required && !hasVal) {
      return { ok: false, message: `Missing selection for add-on group: ${g.nameEn || g.nameAr || g.id}` };
    }
    if (!hasVal) continue;
    const selected = String(val).trim();
    const selectedLower = selected.toLowerCase();
    const opt = (g.options || []).find((o) => {
      const candidates = [o.id, o.name, o.nameAr, o.nameEn]
        .filter((x) => x != null && x !== '')
        .map((x) => String(x).trim());
      return candidates.some((x) => x === selected || x.toLowerCase() === selectedLower);
    });
    if (!opt) {
      return { ok: false, message: `Invalid option for add-on group ${g.id}` };
    }
    normalized[g.id] = String(opt.id);
  }
  return { ok: true, normalized };
}

module.exports = {
  sanitizeAddOnGroups,
  validateSelectedAddOnsAgainstProduct,
};
