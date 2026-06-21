import * as Print from 'expo-print';
import { isStoreAdminRole, itemsSubtotal, grandTotal } from './orders';

function esc(s) {
  return String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Add-ons may be an object map or array — unify to "Group: Option" lines. */
function addOnsLines(item) {
  const raw =
    item?.selectedAddOnsDisplay ??
    item?.selectedAddOns ??
    item?.selectedAddons ??
    item?.addOns ??
    item?.addons;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.entries(raw)
      .map(([g, v]) => `${esc(g)}: ${esc(v)}`)
      .join('<br/>');
  }
  if (Array.isArray(raw) && raw.length) {
    const out = [];
    for (const e of raw) {
      if (!e || typeof e !== 'object') continue;
      const g = e.groupName ?? e.group ?? e.name ?? 'Add-on';
      const v = e.optionName ?? e.option ?? e.value ?? '';
      if (v) out.push(`${esc(g)}: ${esc(v)}`);
    }
    return out.join('<br/>');
  }
  return '';
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch (e) {
    return String(iso);
  }
}

/**
 * Build an 80mm thermal-style receipt and open the native print dialog.
 * Store admin receipts omit fee breakdown; total = items subtotal (matches dashboard).
 */
export async function printOrderReceipt(order, role) {
  if (!order) return;
  const storeAdmin = isStoreAdminRole(role);
  const subtotal = itemsSubtotal(order);
  const deliveryFee = num(order.deliveryFee);
  const serviceFee = num(order.serviceFee);
  const feesTax = num(order.feesTax);
  const total = storeAdmin ? subtotal : grandTotal(order);

  const itemsHtml = (order.items || [])
    .map((i) => {
      const adds = addOnsLines(i);
      const addHtml = adds
        ? `<div style="font-size:11px;color:#444;margin:4px 0 0 8px">${adds}</div>`
        : '';
      const note =
        i.notes && String(i.notes).trim()
          ? `<div style="font-size:11px;color:#555;margin:4px 0 0 8px;font-style:italic">Note: ${esc(
              String(i.notes).trim(),
            )}</div>`
          : '';
      return `<div style="margin-bottom:10px;border-bottom:1px dashed #ccc;padding-bottom:6px"><div><strong>${esc(
        i.name,
      )}</strong> × ${num(i.quantity)} — ${num(i.price).toFixed(2)} JOD</div>${note}${addHtml}</div>`;
    })
    .join('');

  const feesHtml = storeAdmin
    ? ''
    : `<div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${subtotal.toFixed(
        2,
      )} JOD</span></div>
       <div style="display:flex;justify-content:space-between"><span>Delivery fee</span><span>${deliveryFee.toFixed(
         2,
       )} JOD</span></div>
       <div style="display:flex;justify-content:space-between"><span>Service fee</span><span>${serviceFee.toFixed(
         2,
       )} JOD</span></div>
       <div style="display:flex;justify-content:space-between"><span>Tax</span><span>${feesTax.toFixed(
         2,
       )} JOD</span></div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>
      body{font-family:system-ui,-apple-system,sans-serif;font-size:12px;margin:0;padding:12px;color:#111}
      h1{font-size:16px;margin:0 0 6px}
      .label{color:#555;font-size:11px;margin-top:8px}
      hr{border:none;border-top:1px dashed #999;margin:8px 0}
      .total{display:flex;justify-content:space-between;margin-top:8px;font-weight:700;font-size:14px;border-top:1px solid #333;padding-top:6px}
    </style></head><body>
    <h1>Order #${esc(order.id)}</h1>
    <div style="color:#555">${esc(fmtDate(order.createdAtJordan || order.createdAt))}</div>
    <hr style="border-top:1px solid #333"/>
    <div class="label">Store</div>
    <div><strong>${esc(order.storeName || '')}</strong></div>
    <hr/>
    <div class="label">Customer</div>
    ${order.name ? `<div><strong>${esc(order.name)}</strong></div>` : ''}
    <div>${esc(order.phoneNumber || '')}</div>
    ${order.addressName ? `<div style="margin-top:4px">${esc(order.addressName)}</div>` : ''}
    ${
      order.notes && String(order.notes).trim()
        ? `<div class="label">Notes</div><div style="font-size:11px;white-space:pre-wrap">${esc(
            String(order.notes).trim(),
          )}</div>`
        : ''
    }
    <hr/>
    ${itemsHtml}
    <hr/>
    ${feesHtml}
    <div class="total"><span>Total</span><span>${total.toFixed(2)} JOD</span></div>
    <div style="margin-top:8px">Payment: ${esc(order.paymentType || order.paymentMethod || '—')}</div>
    ${order.driverName ? `<div>Driver: ${esc(order.driverName)}</div>` : ''}
    </body></html>`;

  await Print.printAsync({ html });
}
