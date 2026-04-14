/**
 * JOFOTARA e-invoicing integration (Jordan National Electronic Invoicing System).
 *
 * Submits Income Bills (فاتورة دخل) to the government API when orders are delivered.
 * The taxable amount is delivery fee + service fee at 7% (VAT amounts rounded to 2 dp like checkout).
 *
 * Env vars (set on Render):
 *   JOFOTARA_CLIENT_ID, JOFOTARA_SECRET_KEY, JOFOTARA_INCOME_SOURCE,
 *   JOFOTARA_SELLER_TIN, JOFOTARA_SELLER_NAME
 */

const crypto = require('crypto');
const axios = require('axios');
const { JORDAN_IANA_TIMEZONE } = require('./utils/jordanTime');

const JOFOTARA_API_URL = 'https://backend.jofotara.gov.jo/core/invoices/';
const TAX_RATE = 0.07;
/**
 * JoFotara official SDK: DocumentCurrencyCode + TaxCurrencyCode = JOD, but every monetary amount on lines/totals
 * uses currencyID="JO". Using JOD on LineExtensionAmount / TaxAmount / LegalMonetaryTotal breaks JoFotara's
 * totalSpecialTaxesAmount / TaxInclusiveAmount / PayableAmount rules (HTTP 400 after XSD passes).
 */
const AMT_CCY = process.env.JOFOTARA_AMOUNT_CURRENCY || 'JO';
const DOC_CCY = 'JOD';

/** Normalize money from DB / fees (JOD fils) to avoid float dust like 0.649999. */
function roundJod(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

/** Same as checkout `calcFeesTaxJod` / order summary: 2 decimal places for VAT on fees. */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Match jofotara PHP `round($amount, 9)` for XML formatting only (values should already be round2 for money). */
function round9(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e9) / 1e9;
}

/** Activity / income-source serial: digits only, 1–15 chars (JoFotara rule). */
function incomeSourceDigits(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (!s) return '';
  return s.length > 15 ? s.slice(0, 15) : s;
}

function jordanNow() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JORDAN_IANA_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  };
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build UBL 2.1 XML for a JOFOTARA Income Bill.
 * Store orders: one line (delivery + service),7% VAT on combined base. Arheb Box: delivery fee only.
 */
function buildInvoiceXml(order, invoiceUUID, options = {}) {
  const {
    idPrefix = 'ARHEB',
    notePrefix = 'Order',
    includeServiceLine = true,
  } = options || {};
  const INCOME_SOURCE = process.env.JOFOTARA_INCOME_SOURCE || '';
  const SELLER_TIN = process.env.JOFOTARA_SELLER_TIN || '';
  const SELLER_NAME = process.env.JOFOTARA_SELLER_NAME || '';

  const { date } = jordanNow();
  const invoiceId = `${idPrefix}-${order.id}`;
  const activitySerial = incomeSourceDigits(INCOME_SOURCE);

  const deliveryFee = roundJod(Number(order.deliveryFee) || 0);
  const serviceFee = includeServiceLine ? roundJod(Number(order.serviceFee) || 0) : 0;
  const taxableBase = roundJod(deliveryFee + serviceFee);

  /**
   * One taxed line for delivery+service avoids JoFotara summing two line TaxSubtotals differently
   * than the header (duplicate totalSpecialTaxesAmount errors matched two lines).
   * VAT must use round2(7% × base) like checkout — unrounded 0.2555 breaks JoFotara totalSpecialTaxesAmount / payable checks.
   */
  const useCombinedFeeLine = includeServiceLine;
  const taxAmount = useCombinedFeeLine
    ? round2(taxableBase * TAX_RATE)
    : round2(deliveryFee * TAX_RATE);

  const totalWithTax = round2(
    useCombinedFeeLine ? taxableBase + taxAmount : deliveryFee + taxAmount,
  );
  const payableAmount = totalWithTax;

  const f9 = (n) => Number(n).toFixed(9);

  const isCash = String(order.paymentType || '').toLowerCase() !== 'card';
  const paymentCode = isCash ? '011' : '021';
  const buyerName = order.name || 'Customer';

  /**
   * Match jofotara PHP InvoiceLineItem::toXml: TaxTotal has TaxAmount, RoundingAmount (= line tax-inclusive total),
   * then TaxSubtotal (TaxAmount + TaxCategory). Omitting RoundingAmount or wrong currencyID breaks total checks.
   */
  function lineXml(lineId, itemName, qty, unitPrice, discount, lineTax) {
    const taxExcl = roundJod(qty * unitPrice - discount);
    const lineTaxInclusive = round2(taxExcl + lineTax);
    return `<cac:InvoiceLine><cbc:ID>${esc(lineId)}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${f9(qty)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${AMT_CCY}">${f9(taxExcl)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(lineTax)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="${AMT_CCY}">${f9(lineTaxInclusive)}</cbc:RoundingAmount><cac:TaxSubtotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(lineTax)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID><cbc:Percent>${f9(7)}</cbc:Percent><cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:Item><cbc:Name>${esc(itemName)}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="${AMT_CCY}">${f9(unitPrice)}</cbc:PriceAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>DISCOUNT</cbc:AllowanceChargeReason><cbc:Amount currencyID="${AMT_CCY}">${f9(discount)}</cbc:Amount></cac:AllowanceCharge></cac:Price></cac:InvoiceLine>`;
  }

  // JoFotara PHP SDK: SellerSupplierParty holds activity serial (not cac:Delivery).
  const sellerSupplierXml = activitySerial
    ? `<cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>${esc(activitySerial)}</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>`
    : '';

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">',
    '<cbc:UBLVersionID>2.1</cbc:UBLVersionID>',
    `<cbc:ID>${esc(invoiceId)}</cbc:ID>`,
    `<cbc:UUID>${esc(invoiceUUID)}</cbc:UUID>`,
    `<cbc:IssueDate>${esc(date)}</cbc:IssueDate>`,
    `<cbc:InvoiceTypeCode name="${paymentCode}">388</cbc:InvoiceTypeCode>`,
    `<cbc:Note>${esc(notePrefix)} #${order.id}</cbc:Note>`,
    `<cbc:DocumentCurrencyCode>${DOC_CCY}</cbc:DocumentCurrencyCode>`,
    `<cbc:TaxCurrencyCode>${DOC_CCY}</cbc:TaxCurrencyCode>`,
    `<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${order.id}</cbc:UUID></cac:AdditionalDocumentReference>`,
    `<cac:AccountingSupplierParty><cac:Party><cac:PostalAddress><cac:Country><cbc:IdentificationCode>JO</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${esc(SELLER_TIN)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${esc(SELLER_NAME)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="NIN"></cbc:ID></cac:PartyIdentification><cac:PartyLegalEntity><cbc:RegistrationName>${esc(buyerName)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`,
    sellerSupplierXml,
    /** PHP InvoiceTotals: document TaxTotal is only cbc:TaxAmount (no header TaxSubtotal). */
    `<cac:TaxTotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(taxAmount)}</cbc:TaxAmount></cac:TaxTotal>`,
    `<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="${AMT_CCY}">${f9(taxableBase)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${AMT_CCY}">${f9(totalWithTax)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${AMT_CCY}">${f9(payableAmount)}</cbc:PayableAmount></cac:LegalMonetaryTotal>`,
    useCombinedFeeLine
      ? lineXml('1', 'Delivery and service fees', 1, taxableBase, 0, taxAmount)
      : lineXml('1', 'Delivery Fee', 1, deliveryFee, 0, taxAmount),
    '</Invoice>',
  ];

  const xml = parts.filter(Boolean).join('');
  return xml;
}

/**
 * Submit an e-invoice to JOFOTARA for a delivered order.
 * Saves einvoice* columns on the order row regardless of success/failure.
 * @returns {{ ok: boolean, qr?: string, error?: string, uuid: string }}
 */
async function submitJofotaraInvoice(db, orderId) {
  const CLIENT_ID = process.env.JOFOTARA_CLIENT_ID || '';
  const SECRET_KEY = process.env.JOFOTARA_SECRET_KEY || '';

  if (!CLIENT_ID || !SECRET_KEY) {
    const msg = 'JOFOTARA credentials not configured';
    console.warn(`[jofotara] ${msg} — skipping order ${orderId}`);
    try {
      db.prepare(`UPDATE orders SET einvoiceStatus = 'skipped', einvoiceError = ? WHERE id = ?`).run(msg, orderId);
    } catch (e) { /* ignore */ }
    return { ok: false, error: msg, uuid: '' };
  }

  const activitySerial = incomeSourceDigits(process.env.JOFOTARA_INCOME_SOURCE || '');
  if (!activitySerial) {
    const msg = 'JOFOTARA_INCOME_SOURCE must be digits only (activity serial, 1–15 digits)';
    console.warn(`[jofotara] ${msg} — skipping order ${orderId}`);
    try {
      db.prepare(`UPDATE orders SET einvoiceStatus = 'skipped', einvoiceError = ? WHERE id = ?`).run(msg, orderId);
    } catch (e) { /* ignore */ }
    return { ok: false, error: msg, uuid: '' };
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    return { ok: false, error: 'Order not found', uuid: '' };
  }

  const invoiceUUID = crypto.randomUUID();
  const xml = buildInvoiceXml(order, invoiceUUID);
  const base64Invoice = Buffer.from(xml, 'utf-8').toString('base64');

  try {
    db.prepare(`UPDATE orders SET einvoiceStatus = 'pending', einvoiceUUID = ? WHERE id = ?`).run(invoiceUUID, orderId);

    const isCashLog = String(order.paymentType || '').toLowerCase() !== 'card';
    console.log(`[jofotara] Submitting order ${orderId} — UUID ${invoiceUUID}, type=income, payment=${isCashLog ? '011' : '021'}, deliveryFee=${order.deliveryFee}, serviceFee=${order.serviceFee}`);

    const response = await axios.post(JOFOTARA_API_URL, { invoice: base64Invoice }, {
      headers: {
        'Client-Id': CLIENT_ID,
        'Secret-Key': SECRET_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 50000,
    });

    const data = response.data || {};
    console.log(`[jofotara] Response for order ${orderId}:`, JSON.stringify(data).slice(0, 1000));
    const qr = data.EINV_QR || data.qrCode || '';

    db.prepare(
      `UPDATE orders SET einvoiceStatus = 'submitted', einvoiceQR = ?, einvoiceSubmittedAt = ? WHERE id = ?`,
    ).run(qr, new Date().toISOString(), orderId);

    console.log(`[jofotara] Invoice submitted for order ${orderId} — UUID ${invoiceUUID}`);
    return { ok: true, qr, uuid: invoiceUUID };
  } catch (error) {
    const status = error.response?.status;
    const errData = error.response?.data;
    const fullBody = typeof errData === 'string' ? errData : JSON.stringify(errData, null, 2);
    console.error(`[jofotara] FAILED order ${orderId} — HTTP ${status || 'N/A'}`);
    console.error(`[jofotara] Response body:`, fullBody);
    console.error(`[jofotara] Generated XML:\n`, xml);

    let errMsg;
    if (errData?.EINV_RESULTS?.ERRORS?.length) {
      errMsg = errData.EINV_RESULTS.ERRORS.map((e) => `${e.EINV_CODE || e.code || e.type || 'ERROR'}: ${e.EINV_MESSAGE || e.message || e.EINV_CATEGORY || JSON.stringify(e)}`).join('; ');
    } else if (typeof errData === 'string') {
      errMsg = errData;
    } else {
      errMsg = errData?.message || errData?.error || fullBody || error.message || 'Unknown error';
    }
    const shortErr = String(errMsg).slice(0, 1000);

    try {
      db.prepare(
        `UPDATE orders SET einvoiceStatus = 'failed', einvoiceError = ? WHERE id = ?`,
      ).run(shortErr, orderId);
    } catch (e) { /* ignore */ }

    return { ok: false, error: shortErr, uuid: invoiceUUID };
  }
}

/**
 * Submit e-invoice for delivered Arheb Box request.
 */
async function submitJofotaraInvoiceForArhebBox(db, requestId) {
  const CLIENT_ID = process.env.JOFOTARA_CLIENT_ID || '';
  const SECRET_KEY = process.env.JOFOTARA_SECRET_KEY || '';

  if (!CLIENT_ID || !SECRET_KEY) {
    const msg = 'JOFOTARA credentials not configured';
    try {
      db.prepare(`UPDATE arheb_box_requests SET einvoiceStatus = 'skipped', einvoiceError = ? WHERE id = ?`).run(msg, requestId);
    } catch (e) { /* ignore */ }
    return { ok: false, error: msg, uuid: '' };
  }

  const activitySerial = incomeSourceDigits(process.env.JOFOTARA_INCOME_SOURCE || '');
  if (!activitySerial) {
    const msg = 'JOFOTARA_INCOME_SOURCE must be digits only (activity serial, 1–15 digits)';
    try {
      db.prepare(`UPDATE arheb_box_requests SET einvoiceStatus = 'skipped', einvoiceError = ? WHERE id = ?`).run(msg, requestId);
    } catch (e) { /* ignore */ }
    return { ok: false, error: msg, uuid: '' };
  }

  const row = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(requestId);
  if (!row) return { ok: false, error: 'Request not found', uuid: '' };

  const invoiceUUID = crypto.randomUUID();
  const pseudoOrder = {
    id: row.id,
    deliveryFee: Number(row.deliveryFee) || 0,
    serviceFee: 0,
    feesTax: row.feesTax,
    paymentType: row.paymentMethod || 'cash',
    name: row.userName || 'Customer',
  };
  const xml = buildInvoiceXml(pseudoOrder, invoiceUUID, {
    idPrefix: 'ARHEBBOX',
    notePrefix: 'Arheb Box',
    includeServiceLine: false,
  });
  const base64Invoice = Buffer.from(xml, 'utf-8').toString('base64');

  try {
    db.prepare(`UPDATE arheb_box_requests SET einvoiceStatus = 'pending', einvoiceUUID = ? WHERE id = ?`).run(invoiceUUID, requestId);
    const response = await axios.post(JOFOTARA_API_URL, { invoice: base64Invoice }, {
      headers: {
        'Client-Id': CLIENT_ID,
        'Secret-Key': SECRET_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 50000,
    });
    const data = response.data || {};
    const qr = data.EINV_QR || data.qrCode || '';
    db.prepare(
      `UPDATE arheb_box_requests SET einvoiceStatus = 'submitted', einvoiceQR = ?, einvoiceSubmittedAt = ? WHERE id = ?`,
    ).run(qr, new Date().toISOString(), requestId);
    return { ok: true, qr, uuid: invoiceUUID };
  } catch (error) {
    const errData = error.response?.data;
    const fullBody = typeof errData === 'string' ? errData : JSON.stringify(errData, null, 2);
    let errMsg;
    if (errData?.EINV_RESULTS?.ERRORS?.length) {
      errMsg = errData.EINV_RESULTS.ERRORS.map((e) => `${e.EINV_CODE || e.code || e.type || 'ERROR'}: ${e.EINV_MESSAGE || e.message || e.EINV_CATEGORY || JSON.stringify(e)}`).join('; ');
    } else if (typeof errData === 'string') {
      errMsg = errData;
    } else {
      errMsg = errData?.message || errData?.error || fullBody || error.message || 'Unknown error';
    }
    const shortErr = String(errMsg).slice(0, 1000);
    try {
      db.prepare(`UPDATE arheb_box_requests SET einvoiceStatus = 'failed', einvoiceError = ? WHERE id = ?`).run(shortErr, requestId);
    } catch (e) { /* ignore */ }
    return { ok: false, error: shortErr, uuid: invoiceUUID };
  }
}

module.exports = { submitJofotaraInvoice, submitJofotaraInvoiceForArhebBox, buildInvoiceXml };
