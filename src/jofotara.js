/**
 * JOFOTARA e-invoicing integration (Jordan National Electronic Invoicing System).
 *
 * Submits e-invoices to the government API when orders are delivered (category + payment code from env).
 * Default XML: delivery and service fees **as on the order**; **no 7% added** in UBL (zero-rated lines). App checkout VAT is unchanged.
 * Optional legacy: JOFOTARA_INVOICE_XML_VAT=true uses JOFOTARA_VAT_PERCENT (default 7) for category S lines or baked gross on income.
 *
 * Env vars (set on Render):
 *   JOFOTARA_CLIENT_ID, JOFOTARA_SECRET_KEY, JOFOTARA_INCOME_SOURCE,
 *   JOFOTARA_SELLER_TIN, JOFOTARA_SELLER_NAME, JOFOTARA_INVOICE_XML_VAT (optional, default off),
 *   JOFOTARA_VAT_PERCENT (only when JOFOTARA_INVOICE_XML_VAT=true, default 7)
 *   JOFOTARA_INVOICE_CATEGORY: income | general_sales | special_sales (default general_sales).
 *   Must match the invoice type tied to your "تسلسل مصدر الدخل" / activity in the portal (e.g. ضريبة دخل → use **income**, codes 011/021).
 *   If the portal shows **ضريبة دخل** for your serial but Render still sends 012/022, you left the default **general_sales** on
 *   the server — set JOFOTARA_INVOICE_CATEGORY=income. Otherwise JoFotara returns invoice-persist: not authorized.
 *   If you are registered for **مبيعات عامة** with standard VAT on the invoice, use general_sales (012/022) or special_sales (013/023).
 *   With default XML (no JOFOTARA_INVOICE_XML_VAT), all categories use zero-rated (O) lines with fee amounts unchanged.
 *
 * Authorization (HTTP 400, EINV_CODE invoice-persist): "This user is not authorized to submit this type of invoice."
 *   Almost always: category/payment code in XML does not match what that income source is allowed to issue — align
 *   JOFOTARA_INVOICE_CATEGORY with the portal (income vs general_sales), or enable the matching bill type in ISTD.
 */

const crypto = require('crypto');
const axios = require('axios');
const { JORDAN_IANA_TIMEZONE } = require('./utils/jordanTime');

const JOFOTARA_API_URL = 'https://backend.jofotara.gov.jo/core/invoices/';
const DEFAULT_VAT_PERCENT = 7;
/**
 * JoFotara official SDK: DocumentCurrencyCode + TaxCurrencyCode = JOD, but every monetary amount on lines/totals
 * uses currencyID="JO". Using JOD on LineExtensionAmount / TaxAmount / LegalMonetaryTotal breaks JoFotara's
 * totalSpecialTaxesAmount / TaxInclusiveAmount / PayableAmount rules (HTTP 400 after XSD passes).
 */
const AMT_CCY = process.env.JOFOTARA_AMOUNT_CURRENCY || 'JO';
const DOC_CCY = 'JOD';

function logJofotaraAuthorizationHint() {
  const cat = invoiceCategoryFromEnv();
  const pc = paymentCodesForCategory(cat);
  console.error(
    '[jofotara] If the message says your user is "not authorized" for this invoice type: (1) In the portal, if your activity is ضريبة دخل (income), set Render env JOFOTARA_INVOICE_CATEGORY=income (sends 011/021), not the default general_sales (012/022). '
      + `(2) Current server setting: ${cat} — cash ${pc.cash}, non-cash ${pc.receivable}. `
      + '(3) If your registration is actually general/special sales, ask ISTD to enable that type for this API user.',
  );
}

/** Normalize money from DB / fees (JOD fils) to avoid float dust like 0.649999. */
function roundJod(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

/** Match jofotara PHP `round($amount, 9)` on VAT and invoice totals. */
function round9(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e9) / 1e9;
}

function vatPercentFromEnv() {
  const v = Number(process.env.JOFOTARA_VAT_PERCENT);
  if (Number.isFinite(v) && v > 0 && v <= 100) return v;
  return DEFAULT_VAT_PERCENT;
}

/** When true, emit 7% VAT (category S) on fee lines in UBL. Default false: fees as-is, no VAT added in XML. */
function includeStandardVatInJofotaraXml() {
  return String(process.env.JOFOTARA_INVOICE_XML_VAT || '').trim().toLowerCase() === 'true';
}

/** JoFotara payment codes by taxpayer / invoice category (must match category or API rejects totals). */
const INVOICE_CATEGORIES = ['income', 'general_sales', 'special_sales'];

function invoiceCategoryFromEnv() {
  const raw = String(process.env.JOFOTARA_INVOICE_CATEGORY || 'general_sales').trim().toLowerCase();
  return INVOICE_CATEGORIES.includes(raw) ? raw : 'general_sales';
}

function paymentCodesForCategory(category) {
  switch (category) {
    case 'income':
      return { cash: '011', receivable: '021' };
    case 'special_sales':
      return { cash: '013', receivable: '023' };
    case 'general_sales':
    default:
      return { cash: '012', receivable: '022' };
  }
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
 * Build UBL 2.1 XML for JOFOTARA (category from JOFOTARA_INVOICE_CATEGORY, default general_sales).
 * By default: delivery and service fee **amounts match the order**; UBL uses zero-rated (O) lines — **no 7% added** in XML.
 * Legacy: set JOFOTARA_INVOICE_XML_VAT=true for separate 7% VAT lines (general_sales/special_sales) or baked gross (income).
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

  const invoiceCategory = invoiceCategoryFromEnv();
  const vatPct = vatPercentFromEnv();
  const rate = vatPct / 100;

  const deliveryFee = roundJod(Number(order.deliveryFee) || 0);
  const serviceFee = includeServiceLine ? roundJod(Number(order.serviceFee) || 0) : 0;
  const taxableBase = roundJod(deliveryFee + serviceFee);

  const f9 = (n) => Number(n).toFixed(9);

  const isCash = String(order.paymentType || '').toLowerCase() !== 'card';
  const pc = paymentCodesForCategory(invoiceCategory);
  const paymentCode = isCash ? pc.cash : pc.receivable;
  const buyerName = order.name || 'Customer';

  /** Standard-rated line (general_sales / special_sales with VAT). */
  const taxCategoryStandardXml = () =>
    `<cac:TaxCategory><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID><cbc:Percent>${f9(vatPct)}</cbc:Percent><cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>`;

  /** Income / non-VAT UBL: zero-rated (Odoo-style) so amounts are gross on the line, no VAT breakdown. */
  const taxCategoryZeroXml = () =>
    `<cac:TaxCategory><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">O</cbc:ID><cbc:Percent>${f9(0)}</cbc:Percent><cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>`;

  /**
   * VAT invoice line: TaxSubtotal includes TaxableAmount (JoFotara / Odoo general_sales aggregate checks).
   */
  function lineXmlVat(lineId, itemName, qty, unitPrice, discount, lineTax) {
    const taxExcl = roundJod(qty * unitPrice - discount);
    const lineTaxInclusive = round9(taxExcl + lineTax);
    return `<cac:InvoiceLine><cbc:ID>${esc(lineId)}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${f9(qty)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${AMT_CCY}">${f9(taxExcl)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(lineTax)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="${AMT_CCY}">${f9(lineTaxInclusive)}</cbc:RoundingAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${AMT_CCY}">${f9(taxExcl)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(lineTax)}</cbc:TaxAmount>${taxCategoryStandardXml()}</cac:TaxSubtotal></cac:TaxTotal><cac:Item><cbc:Name>${esc(itemName)}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="${AMT_CCY}">${f9(unitPrice)}</cbc:PriceAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>DISCOUNT</cbc:AllowanceChargeReason><cbc:Amount currencyID="${AMT_CCY}">${f9(discount)}</cbc:Amount></cac:AllowanceCharge></cac:Price></cac:InvoiceLine>`;
  }

  /** Income invoice line: gross amount as line extension, 0 tax (do not mix 011 with 7% S lines). */
  function lineXmlIncomeGross(lineId, itemName, qty, grossAmount) {
    const g = round9(grossAmount);
    return `<cac:InvoiceLine><cbc:ID>${esc(lineId)}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${f9(qty)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${AMT_CCY}">${f9(g)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(0)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="${AMT_CCY}">${f9(g)}</cbc:RoundingAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${AMT_CCY}">${f9(g)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(0)}</cbc:TaxAmount>${taxCategoryZeroXml()}</cac:TaxSubtotal></cac:TaxTotal><cac:Item><cbc:Name>${esc(itemName)}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="${AMT_CCY}">${f9(g)}</cbc:PriceAmount><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>DISCOUNT</cbc:AllowanceChargeReason><cbc:Amount currencyID="${AMT_CCY}">${f9(0)}</cbc:Amount></cac:AllowanceCharge></cac:Price></cac:InvoiceLine>`;
  }

  let taxAmount;
  let linesXml;
  let documentTaxTotalXml;
  let taxExclusiveTotal;
  let totalWithTax;
  let payableAmount;

  if (!includeStandardVatInJofotaraXml()) {
    /** Fees exactly as on the order; UBL tax = 0 (category O). No 7% added in XML. */
    let grossSum = 0;
    let lineId = 1;
    const parts = [];
    if (includeServiceLine && deliveryFee > 0 && serviceFee > 0) {
      parts.push(lineXmlIncomeGross(String(lineId++), 'Delivery fee', 1, round9(deliveryFee)));
      parts.push(lineXmlIncomeGross(String(lineId++), 'Service fee', 1, round9(serviceFee)));
      grossSum = round9(deliveryFee + serviceFee);
    } else if (includeServiceLine) {
      const base = taxableBase;
      parts.push(lineXmlIncomeGross('1', 'Delivery and service fees', 1, round9(base)));
      grossSum = round9(base);
    } else {
      parts.push(lineXmlIncomeGross('1', 'Delivery Fee', 1, round9(deliveryFee)));
      grossSum = round9(deliveryFee);
    }
    linesXml = parts.join('');
    taxAmount = 0;
    taxExclusiveTotal = grossSum;
    totalWithTax = grossSum;
    payableAmount = grossSum;
    documentTaxTotalXml = `<cac:TaxTotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(0)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${AMT_CCY}">${f9(grossSum)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(0)}</cbc:TaxAmount>${taxCategoryZeroXml()}</cac:TaxSubtotal></cac:TaxTotal>`;
  } else if (invoiceCategory === 'income') {
    let grossSum = 0;
    let lineId = 1;
    const parts = [];
    if (includeServiceLine && deliveryFee > 0 && serviceFee > 0) {
      const g1 = round9(deliveryFee + round9(deliveryFee * rate));
      const g2 = round9(serviceFee + round9(serviceFee * rate));
      parts.push(lineXmlIncomeGross(String(lineId++), 'Delivery fee', 1, g1));
      parts.push(lineXmlIncomeGross(String(lineId++), 'Service fee', 1, g2));
      grossSum = round9(g1 + g2);
    } else if (includeServiceLine) {
      const base = taxableBase;
      const g = round9(base + round9(base * rate));
      parts.push(lineXmlIncomeGross('1', 'Delivery and service fees', 1, g));
      grossSum = g;
    } else {
      const g = round9(deliveryFee + round9(deliveryFee * rate));
      parts.push(lineXmlIncomeGross('1', 'Delivery Fee', 1, g));
      grossSum = g;
    }
    linesXml = parts.join('');
    taxAmount = 0;
    taxExclusiveTotal = grossSum;
    totalWithTax = grossSum;
    payableAmount = grossSum;
    documentTaxTotalXml = `<cac:TaxTotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(0)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${AMT_CCY}">${f9(grossSum)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(0)}</cbc:TaxAmount>${taxCategoryZeroXml()}</cac:TaxSubtotal></cac:TaxTotal>`;
  } else {
    if (includeServiceLine && deliveryFee > 0 && serviceFee > 0) {
      const tDel = round9(deliveryFee * rate);
      const tSvc = round9(serviceFee * rate);
      taxAmount = round9(tDel + tSvc);
      linesXml =
        lineXmlVat('1', 'Delivery fee', 1, deliveryFee, 0, tDel) + lineXmlVat('2', 'Service fee', 1, serviceFee, 0, tSvc);
    } else if (includeServiceLine) {
      const base = taxableBase;
      taxAmount = round9(base * rate);
      linesXml = lineXmlVat('1', 'Delivery and service fees', 1, base, 0, taxAmount);
    } else {
      taxAmount = round9(deliveryFee * rate);
      linesXml = lineXmlVat('1', 'Delivery Fee', 1, deliveryFee, 0, taxAmount);
    }

    const taxExc = includeServiceLine ? taxableBase : deliveryFee;
    taxExclusiveTotal = round9(taxExc);
    totalWithTax = round9(taxExc + taxAmount);
    payableAmount = totalWithTax;

    const docTaxable = taxExclusiveTotal;
    documentTaxTotalXml = `<cac:TaxTotal><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(taxAmount)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${AMT_CCY}">${f9(docTaxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${AMT_CCY}">${f9(taxAmount)}</cbc:TaxAmount>${taxCategoryStandardXml()}</cac:TaxSubtotal></cac:TaxTotal>`;
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
    documentTaxTotalXml,
    `<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="${AMT_CCY}">${f9(taxExclusiveTotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${AMT_CCY}">${f9(totalWithTax)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${AMT_CCY}">${f9(payableAmount)}</cbc:PayableAmount></cac:LegalMonetaryTotal>`,
    linesXml,
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
    const cat = invoiceCategoryFromEnv();
    const pcLog = paymentCodesForCategory(cat);
    const payLog = isCashLog ? pcLog.cash : pcLog.receivable;
    console.log(
      `[jofotara] Submitting order ${orderId} — UUID ${invoiceUUID}, category=${cat}, payment=${payLog}, xmlVat=${includeStandardVatInJofotaraXml()}, deliveryFee=${order.deliveryFee}, serviceFee=${order.serviceFee}`,
    );

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
    if (fullBody && /not authorized to submit this type of invoice|invoice-persist/i.test(String(fullBody))) {
      logJofotaraAuthorizationHint();
    }

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
  const del = Number(row.deliveryFee) || 0;
  const svc = Number(row.serviceFee) || 0;
  const pseudoOrder = {
    id: row.id,
    deliveryFee: del,
    serviceFee: svc,
    feesTax: row.feesTax,
    paymentType: row.paymentMethod || 'cash',
    name: row.userName || 'Customer',
  };
  const xml = buildInvoiceXml(pseudoOrder, invoiceUUID, {
    idPrefix: 'ARHEBBOX',
    notePrefix: 'Arheb Box',
    includeServiceLine: true,
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
    if (fullBody && /not authorized to submit this type of invoice|invoice-persist/i.test(String(fullBody))) {
      logJofotaraAuthorizationHint();
    }
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
