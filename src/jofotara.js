/**
 * JOFOTARA e-invoicing integration (Jordan National Electronic Invoicing System).
 *
 * Submits Income Bills (فاتورة دخل) to the government API when orders are delivered.
 * The taxable amount is delivery fee + service fee at 7%.
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

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function round9(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e9) / 1e9;
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
 * Two invoice lines: (1) Delivery Fee, (2) Service Fee — both taxed at 7%.
 */
function buildInvoiceXml(order, invoiceUUID) {
  const CLIENT_ID = process.env.JOFOTARA_CLIENT_ID || '';
  const INCOME_SOURCE = process.env.JOFOTARA_INCOME_SOURCE || '';
  const SELLER_TIN = process.env.JOFOTARA_SELLER_TIN || '';
  const SELLER_NAME = process.env.JOFOTARA_SELLER_NAME || '';

  const { date, time } = jordanNow();
  const invoiceId = `ARHEB-${order.id}`;

  const deliveryFee = round2(Number(order.deliveryFee) || 0);
  const serviceFee = round2(Number(order.serviceFee) || 0.65);
  const taxableBase = round2(deliveryFee + serviceFee);
  const taxAmount = round2(taxableBase * TAX_RATE);
  const totalWithTax = round2(taxableBase + taxAmount);

  const deliveryTax = round9(deliveryFee * TAX_RATE);
  const serviceTax = round9(serviceFee * TAX_RATE);

  const isCash = String(order.paymentType || '').toLowerCase() !== 'card';
  const paymentCode = isCash ? '011' : '021';

  const buyerName = order.name || 'Customer';
  const buyerPhone = order.phoneNumber || '';

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">',
    '<cbc:UBLVersionID>2.1</cbc:UBLVersionID>',
    '<cbc:ProfileID>reporting:1.0</cbc:ProfileID>',
    `<cbc:ID>${esc(invoiceId)}</cbc:ID>`,
    `<cbc:UUID>${esc(invoiceUUID)}</cbc:UUID>`,
    `<cbc:IssueDate>${esc(date)}</cbc:IssueDate>`,
    `<cbc:InvoiceTypeCode name="${paymentCode}">388</cbc:InvoiceTypeCode>`,
    `<cbc:Note>Order #${order.id}</cbc:Note>`,
    '<cbc:DocumentCurrencyCode>JOD</cbc:DocumentCurrencyCode>',
    '<cbc:TaxCurrencyCode>JOD</cbc:TaxCurrencyCode>',
    `<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${order.id}</cbc:UUID></cac:AdditionalDocumentReference>`,
    `<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="TIN">${esc(SELLER_TIN)}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(SELLER_NAME)}</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="NIN">0</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${esc(buyerName)}</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty>`,
    `<cac:Delivery><cac:DeliveryParty><cac:PartyLegalEntity><cbc:RegistrationName>${esc(INCOME_SOURCE)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:DeliveryParty></cac:Delivery>`,
    `<cac:PaymentMeans><cbc:PaymentMeansCode>${paymentCode}</cbc:PaymentMeansCode></cac:PaymentMeans>`,
    `<cac:TaxTotal><cbc:TaxAmount currencyID="JOD">${taxAmount.toFixed(2)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="JOD">${taxableBase.toFixed(2)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="JOD">${taxAmount.toFixed(2)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>7.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`,
    `<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="JOD">${taxableBase.toFixed(2)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="JOD">${totalWithTax.toFixed(2)}</cbc:TaxInclusiveAmount><cbc:AllowanceTotalAmount currencyID="JOD">0.00</cbc:AllowanceTotalAmount><cbc:PayableAmount currencyID="JOD">${totalWithTax.toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>`,
    `<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="JOD">${deliveryFee.toFixed(2)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="JOD">${round2(deliveryTax).toFixed(2)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="JOD">${round2(deliveryFee + deliveryTax).toFixed(2)}</cbc:RoundingAmount></cac:TaxTotal><cac:Item><cbc:Name>Delivery Fee</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>7.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="JOD">${deliveryFee.toFixed(2)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`,
    `<cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="JOD">${serviceFee.toFixed(2)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="JOD">${round2(serviceTax).toFixed(2)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="JOD">${round2(serviceFee + serviceTax).toFixed(2)}</cbc:RoundingAmount></cac:TaxTotal><cac:Item><cbc:Name>Service Fee</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>7.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="JOD">${serviceFee.toFixed(2)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`,
    '</Invoice>',
  ];

  const xml = parts.join('');
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
      errMsg = errData.EINV_RESULTS.ERRORS.map((e) => `${e.code || e.type || 'ERROR'}: ${e.message || e.category || JSON.stringify(e)}`).join('; ');
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

module.exports = { submitJofotaraInvoice, buildInvoiceXml };
