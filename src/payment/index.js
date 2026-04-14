const crypto = require('crypto');
const axios = require('axios');
const express = require('express');
const attachCheckoutRoutes = require('../checkout');
const { createArhebBoxRequest, ensureArhebBoxTable, enrichArhebBoxRow, notifyDriversAboutNewArhebBox } = require('../arhebBox');

const PAYTABS_API_URL = 'https://madfoat-secure.paytabs.com';
const PROFILE_ID = 47149;

function deleteOrderCascade(db, orderId) {
  try {
    db.prepare('DELETE FROM order_items WHERE orderId = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  } catch (e) {
    console.error('deleteOrderCascade error:', e);
  }
}

module.exports = function attachPaymentRoutes(app, db, authenticateRequest, io) {
  const SERVER_KEY = process.env.PAYTABS_SERVER_KEY || '';
  const CLIENT_KEY = process.env.PAYTABS_CLIENT_KEY || '';
  const CART_CURRENCY = process.env.PAYTABS_CURRENCY || 'JOD';
  const BASE_URL = process.env.BASE_URL || '';

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER,
      tranRef TEXT UNIQUE,
      cartId TEXT NOT NULL,
      cartAmount REAL NOT NULL,
      cartCurrency TEXT DEFAULT 'JOD',
      tranType TEXT DEFAULT 'sale',
      status TEXT DEFAULT 'initiated',
      redirectUrl TEXT,
      responseStatus TEXT,
      responseCode TEXT,
      responseMessage TEXT,
      token TEXT,
      paymentDescription TEXT,
      cardScheme TEXT,
      cardType TEXT,
      customerEmail TEXT,
      rawResponse TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { db.exec('ALTER TABLE payment_transactions ADD COLUMN orderId INTEGER'); } catch (e) { /* exists */ }
  try { db.exec('ALTER TABLE payment_transactions ADD COLUMN token TEXT'); } catch (e) { /* exists */ }
  try { db.exec('ALTER TABLE payment_transactions ADD COLUMN arhebBoxRequestId INTEGER'); } catch (e) { /* exists */ }
  try { db.exec('ALTER TABLE payment_transactions ADD COLUMN pendingCheckoutJson TEXT'); } catch (e) { /* exists */ }
  try { db.exec('ALTER TABLE payment_transactions ADD COLUMN pendingArhebBoxJson TEXT'); } catch (e) { /* exists */ }
  try { db.exec('ALTER TABLE payment_transactions ADD COLUMN pendingPhoneNumber TEXT'); } catch (e) { /* exists */ }

  ensureArhebBoxTable(db);

  function paytabsHeaders() {
    return {
      'authorization': SERVER_KEY,
      'content-type': 'application/json',
    };
  }

  const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?');

  function applyCardPaymentSuccessToOrder(orderId, tranRef) {
    if (orderId == null) return;
    try {
      db.prepare(
        "UPDATE orders SET paymentType = 'Card', status = 'Waiting confirmation', paymentTranRef = COALESCE(?, paymentTranRef) WHERE id = ?",
      ).run(tranRef || null, orderId);
      try {
        const { emitOrderEvent } = require('../order');
        if (emitOrderEvent) emitOrderEvent(orderId, 'status_update', { status: 'Waiting confirmation' });
      } catch (_) { /* ignore */ }
    } catch (e) {
      console.error('applyCardPaymentSuccessToOrder:', e);
    }
  }

  function applyCardPaymentSuccessToArhebBox(requestId, tranRef) {
    if (requestId == null) return;
    try {
      const info = db.prepare("UPDATE arheb_box_requests SET paymentMethod = 'card', status = 'pending' WHERE id = ? AND status = 'pending_payment'").run(requestId);
      if (info.changes > 0) {
        try {
          const { emitArhebBoxEvent } = require('../order');
          if (emitArhebBoxEvent) emitArhebBoxEvent(requestId, 'status_update', { status: 'pending' });
        } catch (_) { /* ignore */ }
      }
    } catch (e) {
      console.error('applyCardPaymentSuccessToArhebBox:', e);
    }
  }

  function finalizePendingEntitiesForTransaction(existing, tranRef) {
    if (!existing || existing.orderId || existing.arhebBoxRequestId) return;
    if (existing.pendingCheckoutJson) {
      try {
        const createOrderFromCheckoutBody = attachCheckoutRoutes.createOrderFromCheckoutBody;
        if (typeof createOrderFromCheckoutBody !== 'function') return;
        const checkout = JSON.parse(existing.pendingCheckoutJson);
        const userId = existing.pendingPhoneNumber || checkout?.phoneNumber;
        const createRes = createOrderFromCheckoutBody(userId, checkout, {
          forcePaymentType: 'Card',
          initialStatusOverride: 'Waiting confirmation',
        });
        if (!createRes.ok) {
          console.error('finalizePendingEntitiesForTransaction checkout failed:', createRes.message);
          return;
        }
        const orderId = createRes.orderId;
        db.prepare('UPDATE orders SET paymentTranRef = COALESCE(?, paymentTranRef), paymentCartId = COALESCE(?, paymentCartId) WHERE id = ?').run(tranRef || null, existing.cartId || null, orderId);
        db.prepare('UPDATE payment_transactions SET orderId = ?, pendingCheckoutJson = NULL, pendingPhoneNumber = NULL WHERE tranRef = ?').run(orderId, tranRef);
        applyCardPaymentSuccessToOrder(orderId, tranRef);
      } catch (e) {
        console.error('finalizePendingEntitiesForTransaction checkout exception:', e);
      }
      return;
    }
    if (existing.pendingArhebBoxJson) {
      try {
        const arhebBox = JSON.parse(existing.pendingArhebBoxJson);
        const phoneNumber = existing.pendingPhoneNumber || arhebBox?.phoneNumber;
        const createRes = createArhebBoxRequest(db, phoneNumber, arhebBox, 'pending', {
          allowWhenPaused: true,
        });
        if (!createRes.ok) {
          console.error('finalizePendingEntitiesForTransaction arheb-box failed:', createRes.message);
          return;
        }
        db.prepare('UPDATE payment_transactions SET arhebBoxRequestId = ?, pendingArhebBoxJson = NULL, pendingPhoneNumber = NULL WHERE tranRef = ?').run(createRes.requestId, tranRef);
        applyCardPaymentSuccessToArhebBox(createRes.requestId, tranRef);
        const newBoxRow = db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(createRes.requestId);
        notifyDriversAboutNewArhebBox(db, io, newBoxRow);
        try {
          const { notifyArhebBoxCustomerRequestReceived } = require('../utils/arhebBoxFcm');
          notifyArhebBoxCustomerRequestReceived(db, newBoxRow);
        } catch (e2) {
          console.warn('[payment] arheb-box customer notify:', e2?.message || e2);
        }
      } catch (e) {
        console.error('finalizePendingEntitiesForTransaction arheb-box exception:', e);
      }
    }
  }

  // --- Initiate Arheb Box card payment ---
  app.post('/api/payment/arheb-box/initiate', authenticateRequest, async (req, res) => {
    try {
      const { arhebBox, currency, customerName, customerEmail, customerPhone } = req.body || {};
      if (!arhebBox || typeof arhebBox !== 'object') {
        return res.status(400).json({ success: false, message: 'arhebBox object is required with pickup, dropoff, receiverPhone, receiverName, paymentMethod, whoPays, amount' });
      }

      const phoneNumber = req.user.phoneNumber;
      const boxBody = { ...arhebBox, paymentMethod: 'card' };
      const dryRun = createArhebBoxRequest(db, phoneNumber, boxBody, { dryRun: true });
      if (!dryRun.ok) {
        return res.status(dryRun.statusCode || 400).json({ success: false, message: dryRun.message, ...(dryRun.data ? { data: dryRun.data } : {}) });
      }
      const amount = Number(dryRun.preview?.total);

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid total amount' });
      }

      const cartId = `ARHEBBOX-PENDING-${Date.now()}`;
      const cartCurrency = currency || CART_CURRENCY;
      const cartDescription = 'Arheb Box payment';
      const callbackUrl = BASE_URL ? `${BASE_URL}/api/payment/callback` : '';
      const returnUrl = BASE_URL ? `${BASE_URL}/api/payment/return` : '';

      const payload = {
        profile_id: PROFILE_ID,
        tran_type: 'sale',
        tran_class: 'ecom',
        cart_id: cartId,
        cart_description: cartDescription,
        cart_currency: cartCurrency,
        cart_amount: amount,
        hide_shipping: true,
      };
      if (callbackUrl) payload.callback = callbackUrl;
      if (returnUrl) payload.return = returnUrl;

      const cName = customerName || dryRun.row?.userName || undefined;
      const cEmail = customerEmail || undefined;
      const cPhone = customerPhone || phoneNumber || undefined;
      if (cName || cEmail || cPhone) {
        payload.customer_details = {};
        if (cName) payload.customer_details.name = cName;
        if (cEmail) payload.customer_details.email = cEmail;
        if (cPhone) payload.customer_details.phone = cPhone;
      }

      let data;
      try {
        const response = await axios.post(`${PAYTABS_API_URL}/payment/request`, payload, { headers: paytabsHeaders(), timeout: 30000 });
        data = response.data;
      } catch (error) {
        const errData = error.response?.data;
        console.error('Payment arheb-box initiate error:', errData || error.message);
        return res.status(error.response?.status || 500).json({ success: false, message: errData?.message || error.message || 'Payment request failed' });
      }

      const tranRef = data.tran_ref || null;

      db.prepare(`
        INSERT INTO payment_transactions (arhebBoxRequestId, tranRef, cartId, cartAmount, cartCurrency, tranType, status, redirectUrl, rawResponse, pendingArhebBoxJson, pendingPhoneNumber)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(null, tranRef, cartId, amount, cartCurrency, 'sale',
        data.redirect_url ? 'pending_redirect' : (data.payment_result?.response_status === 'A' ? 'completed' : 'initiated'),
        data.redirect_url || null, JSON.stringify(data), JSON.stringify(boxBody), phoneNumber);

      const paymentBlock = { tranRef, cartId, cartAmount: amount, cartCurrency };

      if (data.payment_result && data.payment_result.response_status === 'A') {
        const existing = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
        finalizePendingEntitiesForTransaction(existing, tranRef);
        const updatedTx = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
        const updatedRow = updatedTx?.arhebBoxRequestId != null
          ? db.prepare('SELECT * FROM arheb_box_requests WHERE id = ?').get(updatedTx.arhebBoxRequestId)
          : null;
        return res.status(201).json({
          success: true,
          message: 'Arheb Box request created and payment completed',
          data: { request: updatedRow ? enrichArhebBoxRow(updatedRow, db) : null, payment: { ...paymentBlock, status: 'completed', paymentResult: data.payment_result } },
          timestamp: new Date().toISOString(),
        });
      }

      if (data.redirect_url) {
        return res.status(201).json({
          success: true,
          message: 'Payment initiated; Arheb Box request will be created after successful payment',
          data: { request: null, payment: { ...paymentBlock, status: 'pending_redirect', redirectUrl: data.redirect_url, redirectMethod: 'GET' } },
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Payment submitted; Arheb Box request will be created after successful payment',
        data: { request: null, payment: { ...paymentBlock, status: 'initiated', rawResponse: data } },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Payment arheb-box initiate error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
  });

  // --- Initiate payment: creates order (checkout) + Madfoat session; paymentType is always Card ---
  app.post('/api/payment/initiate', authenticateRequest, async (req, res) => {
    const createOrderFromCheckoutBody = attachCheckoutRoutes.createOrderFromCheckoutBody;
    if (typeof createOrderFromCheckoutBody !== 'function') {
      return res.status(503).json({ success: false, message: 'Checkout module is not ready' });
    }

    try {
      const {
        checkout,
        currency,
        description,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        customerCity,
        customerCountry,
      } = req.body || {};

      if (!checkout || typeof checkout !== 'object') {
        return res.status(400).json({
          success: false,
          message:
            'checkout is required: same fields as POST /api/checkout (items, phoneNumber, totalAmount, address, etc.). Do not send paymentType; it is set to Card automatically.',
        });
      }

      const checkoutBody = { ...checkout };
      delete checkoutBody.paymentType;

      const userId = req.user.userId || req.user.phoneNumber;
      const dryRun = createOrderFromCheckoutBody(userId, checkoutBody, {
        forcePaymentType: 'Card',
        initialStatusOverride: 'Pending payment',
        dryRun: true,
      });

      if (!dryRun.ok) {
        return res.status(dryRun.statusCode).json({ success: false, message: dryRun.message });
      }

      const amount = Number(dryRun.preview?.totalAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid order totalAmount' });
      }

      const cartId = `ORDER-PENDING-${Date.now()}`;
      const cartCurrency = currency || CART_CURRENCY;
      const cartDescription = description || 'Arheb checkout payment';

      const callbackUrl = BASE_URL ? `${BASE_URL}/api/payment/callback` : '';
      const returnUrl = BASE_URL ? `${BASE_URL}/api/payment/return` : '';

      const payload = {
        profile_id: PROFILE_ID,
        tran_type: 'sale',
        tran_class: 'ecom',
        cart_id: cartId,
        cart_description: cartDescription,
        cart_currency: cartCurrency,
        cart_amount: amount,
        hide_shipping: true,
      };

      if (callbackUrl) payload.callback = callbackUrl;
      if (returnUrl) payload.return = returnUrl;

      const cName = customerName || dryRun.preview?.name || undefined;
      const cEmail = customerEmail || undefined;
      const cPhone = customerPhone || dryRun.preview?.phoneNumber || undefined;
      if (cName || cEmail || cPhone || customerAddress || customerCity || customerCountry) {
        payload.customer_details = {};
        if (cName) payload.customer_details.name = cName;
        if (cEmail) payload.customer_details.email = cEmail;
        if (cPhone) payload.customer_details.phone = cPhone;
        if (customerAddress) payload.customer_details.street1 = customerAddress;
        if (customerCity) payload.customer_details.city = customerCity;
        if (customerCountry) payload.customer_details.country = customerCountry;
      }

      let data;
      try {
        const response = await axios.post(`${PAYTABS_API_URL}/payment/request`, payload, {
          headers: paytabsHeaders(),
          timeout: 30000,
        });
        data = response.data;
      } catch (error) {
        const errData = error.response?.data;
        console.error('Payment initiate error:', errData || error.message);
        return res.status(error.response?.status || 500).json({
          success: false,
          message: errData?.message || error.message || 'Payment request failed',
          code: errData?.code || null,
        });
      }

      const tranRef = data.tran_ref || null;

      db.prepare(`
        INSERT INTO payment_transactions (orderId, tranRef, cartId, cartAmount, cartCurrency, tranType, status, redirectUrl, rawResponse, pendingCheckoutJson, pendingPhoneNumber)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        null,
        tranRef,
        cartId,
        amount,
        cartCurrency,
        'sale',
        data.redirect_url ? 'pending_redirect' : (data.payment_result?.response_status === 'A' ? 'completed' : 'initiated'),
        data.redirect_url || null,
        JSON.stringify(data),
        JSON.stringify(checkoutBody),
        req.user.phoneNumber || null,
      );

      const paymentBlock = {
        tranRef,
        cartId,
        cartAmount: amount,
        cartCurrency,
      };

      if (data.payment_result && data.payment_result.response_status === 'A') {
        const existing = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
        finalizePendingEntitiesForTransaction(existing, tranRef);
        const tx = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
        const createdOrder = tx?.orderId != null ? findOrderById.get(tx.orderId) : null;
        return res.status(201).json({
          success: true,
          message: 'Payment completed successfully',
          data: {
            checkout: createdOrder ? { orderId: createdOrder.id, order: createdOrder } : null,
            payment: {
              ...paymentBlock,
              status: 'completed',
              paymentResult: data.payment_result,
              paymentInfo: data.payment_info,
            },
          },
          timestamp: new Date().toISOString(),
        });
      }

      if (data.redirect_url) {
        return res.status(201).json({
          success: true,
          message: 'Payment initiated; order will be created after successful payment',
          data: {
            checkout: null,
            payment: {
              ...paymentBlock,
              status: 'pending_redirect',
              redirectUrl: data.redirect_url,
              redirectMethod: 'GET',
            },
          },
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Payment request submitted; order will be created after successful payment',
        data: {
          checkout: null,
          payment: {
            ...paymentBlock,
            status: 'initiated',
            rawResponse: data,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Payment initiate error:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  });

  // --- Callback (server-to-server from Madfoat after redirect completes) ---
  app.post('/api/payment/callback', express.urlencoded({ extended: true }), (req, res) => {
    try {
      const body = req.body || {};
      const {
        tranRef, cartId, respStatus, respCode, respMessage,
        acquirerRRN, acquirerMessage, token, customerEmail, signature,
      } = body;

      if (signature && SERVER_KEY) {
        const fields = { ...body };
        delete fields.signature;
        const filtered = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== ''));
        const sorted = Object.keys(filtered).sort().reduce((acc, k) => { acc[k] = filtered[k]; return acc; }, {});
        const query = new URLSearchParams(sorted).toString();
        const computed = crypto.createHmac('sha256', SERVER_KEY).update(query).digest('hex');
        if (computed !== signature) {
          console.warn('Payment callback: invalid signature', { tranRef, cartId });
          return res.status(400).json({ success: false, message: 'Invalid signature' });
        }
      }

      const status = respStatus === 'A' ? 'completed' : (respStatus === 'D' ? 'declined' : 'failed');

      const existing = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
      if (existing) {
        db.prepare(`
          UPDATE payment_transactions
          SET status = ?, responseStatus = ?, responseCode = ?, responseMessage = ?, token = ?,
              customerEmail = ?, rawResponse = ?, updatedAt = CURRENT_TIMESTAMP
          WHERE tranRef = ?
        `).run(status, respStatus, respCode, respMessage, token || null, customerEmail || null, JSON.stringify(body), tranRef);

        if (status === 'completed') {
          if (existing.arhebBoxRequestId) {
            applyCardPaymentSuccessToArhebBox(existing.arhebBoxRequestId, tranRef);
          } else if (existing.orderId) {
            applyCardPaymentSuccessToOrder(existing.orderId, tranRef);
          }
          finalizePendingEntitiesForTransaction(existing, tranRef);
        }
      } else {
        db.prepare(`
          INSERT INTO payment_transactions (tranRef, cartId, cartAmount, cartCurrency, tranType, status, responseStatus, responseCode, responseMessage, token, customerEmail, rawResponse)
          VALUES (?, ?, 0, 'JOD', 'sale', ?, ?, ?, ?, ?, ?, ?)
        `).run(tranRef, cartId, status, respStatus, respCode, respMessage, token || null, customerEmail || null, JSON.stringify(body));
      }

      console.log('Payment callback received:', { tranRef, cartId, respStatus, respMessage, status });
      return res.status(200).json({ success: true, message: 'Callback processed' });
    } catch (error) {
      console.error('Payment callback error:', error);
      return res.status(200).json({ success: true, message: 'Callback acknowledged' });
    }
  });

  // --- Return URL (browser redirect after 3DS / hosted page) ---
  app.all('/api/payment/return', (req, res) => {
    const params = { ...req.query, ...req.body };
    const { tranRef, respStatus, respMessage } = params;

    if (tranRef) {
      const existing = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
      if (existing && (existing.status === 'pending_redirect' || existing.status === 'initiated')) {
        const status = respStatus === 'A' ? 'completed' : (respStatus === 'D' ? 'declined' : 'unknown');
        db.prepare(`
          UPDATE payment_transactions SET status = ?, responseStatus = ?, responseMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE tranRef = ?
        `).run(status, respStatus || null, respMessage || null, tranRef);
        if (respStatus === 'A') {
          if (existing.arhebBoxRequestId) {
            applyCardPaymentSuccessToArhebBox(existing.arhebBoxRequestId, tranRef);
          } else if (existing.orderId) {
            applyCardPaymentSuccessToOrder(existing.orderId, tranRef);
          }
          finalizePendingEntitiesForTransaction(existing, tranRef);
        }
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f7fafc;}
      .card{text-align:center;padding:2rem;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1);max-width:400px;}
      .success{color:#38a169;} .fail{color:#e53e3e;} h2{margin-top:0;}</style></head>
      <body><div class="card">
      ${respStatus === 'A'
        ? '<h2 class="success">Payment Successful</h2><p>Your payment has been processed. You may close this window.</p>'
        : `<h2 class="fail">Payment ${respStatus === 'D' ? 'Declined' : 'Result'}</h2><p>${respMessage || 'Please try again or contact support.'}</p>`}
      <p style="color:#718096;font-size:0.85rem;">Reference: ${tranRef || 'N/A'}</p>
      </div></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  });

  // --- Query transaction status ---
  app.get('/api/payment/query/:tranRef', authenticateRequest, async (req, res) => {
    try {
      const { tranRef } = req.params;
      if (!tranRef) {
        return res.status(400).json({ success: false, message: 'tranRef is required' });
      }

      const response = await axios.post(`${PAYTABS_API_URL}/payment/query`, {
        profile_id: PROFILE_ID,
        tran_ref: tranRef,
      }, { headers: paytabsHeaders(), timeout: 15000 });

      const data = response.data;
      const status = data.payment_result?.response_status === 'A' ? 'completed'
        : (data.payment_result?.response_status === 'D' ? 'declined' : 'pending');

      const existing = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
      if (existing) {
        db.prepare(`
          UPDATE payment_transactions
          SET status = ?, responseStatus = ?, responseCode = ?, responseMessage = ?,
              paymentDescription = ?, cardScheme = ?, cardType = ?, rawResponse = ?, updatedAt = CURRENT_TIMESTAMP
          WHERE tranRef = ?
        `).run(
          status,
          data.payment_result?.response_status || null,
          data.payment_result?.response_code || null,
          data.payment_result?.response_message || null,
          data.payment_info?.payment_description || null,
          data.payment_info?.card_scheme || null,
          data.payment_info?.card_type || null,
          JSON.stringify(data),
          tranRef,
        );
        if (status === 'completed') {
          if (existing.arhebBoxRequestId) {
            applyCardPaymentSuccessToArhebBox(existing.arhebBoxRequestId, tranRef);
          } else if (existing.orderId) {
            applyCardPaymentSuccessToOrder(existing.orderId, tranRef);
          }
          finalizePendingEntitiesForTransaction(existing, tranRef);
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          tranRef: data.tran_ref,
          cartId: data.cart_id,
          cartAmount: data.cart_amount,
          cartCurrency: data.cart_currency,
          status,
          paymentResult: data.payment_result,
          paymentInfo: data.payment_info,
          customerDetails: data.customer_details,
        },
      });
    } catch (error) {
      const errData = error.response?.data;
      console.error('Payment query error:', errData || error.message);
      return res.status(error.response?.status || 500).json({
        success: false,
        message: errData?.message || error.message || 'Query failed',
      });
    }
  });

  // --- Refund ---
  app.post('/api/payment/refund', authenticateRequest, async (req, res) => {
    try {
      const { tranRef, amount, description } = req.body || {};
      if (!tranRef) {
        return res.status(400).json({ success: false, message: 'tranRef is required' });
      }

      const existing = db.prepare('SELECT * FROM payment_transactions WHERE tranRef = ?').get(tranRef);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
      }

      const refundAmount = typeof amount === 'number' && amount > 0 ? amount : existing.cartAmount;

      const response = await axios.post(`${PAYTABS_API_URL}/payment/request`, {
        profile_id: PROFILE_ID,
        tran_type: 'refund',
        tran_ref: tranRef,
        cart_id: existing.cartId,
        cart_description: description || `Refund for ${existing.cartId}`,
        cart_currency: existing.cartCurrency || CART_CURRENCY,
        cart_amount: refundAmount,
      }, { headers: paytabsHeaders(), timeout: 30000 });

      const data = response.data;
      const refundStatus = data.payment_result?.response_status === 'A' ? 'refunded' : 'refund_failed';

      db.prepare(`
        INSERT INTO payment_transactions (orderId, tranRef, cartId, cartAmount, cartCurrency, tranType, status, responseStatus, responseCode, responseMessage, rawResponse)
        VALUES (?, ?, ?, ?, ?, 'refund', ?, ?, ?, ?, ?)
      `).run(
        existing.orderId || null,
        data.tran_ref || `REFUND-${tranRef}`,
        existing.cartId,
        refundAmount,
        existing.cartCurrency || CART_CURRENCY,
        refundStatus,
        data.payment_result?.response_status || null,
        data.payment_result?.response_code || null,
        data.payment_result?.response_message || null,
        JSON.stringify(data),
      );

      return res.status(200).json({
        success: true,
        message: refundStatus === 'refunded' ? 'Refund processed successfully' : 'Refund request submitted',
        data: {
          originalTranRef: tranRef,
          refundTranRef: data.tran_ref,
          amount: refundAmount,
          status: refundStatus,
          paymentResult: data.payment_result,
        },
      });
    } catch (error) {
      const errData = error.response?.data;
      console.error('Payment refund error:', errData || error.message);
      return res.status(error.response?.status || 500).json({
        success: false,
        message: errData?.message || error.message || 'Refund failed',
      });
    }
  });

  // --- List payment transactions (admin or user's own) ---
  app.get('/api/payment/transactions', authenticateRequest, (req, res) => {
    try {
      const { orderId, status, page = 1, perPage = 20 } = req.query;
      const limit = Math.min(parseInt(perPage) || 20, 50);
      const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

      let where = '1=1';
      const params = [];
      if (orderId) { where += ' AND orderId = ?'; params.push(orderId); }
      if (status) { where += ' AND status = ?'; params.push(status); }

      const total = db.prepare(`SELECT COUNT(*) as count FROM payment_transactions WHERE ${where}`).get(...params).count;
      const rows = db.prepare(`SELECT * FROM payment_transactions WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

      const transactions = rows.map(r => ({
        id: r.id,
        orderId: r.orderId,
        tranRef: r.tranRef,
        cartId: r.cartId,
        cartAmount: r.cartAmount,
        cartCurrency: r.cartCurrency,
        tranType: r.tranType,
        status: r.status,
        responseStatus: r.responseStatus,
        responseMessage: r.responseMessage,
        paymentDescription: r.paymentDescription,
        cardScheme: r.cardScheme,
        cardType: r.cardType,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      return res.status(200).json({
        success: true,
        data: { transactions, total, page: parseInt(page) || 1, perPage: limit },
      });
    } catch (error) {
      console.error('Payment list error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // --- Client key endpoint (for managed form / frontend) ---
  app.get('/api/payment/client-key', (req, res) => {
    return res.status(200).json({
      success: true,
      data: {
        clientKey: CLIENT_KEY || null,
        profileId: PROFILE_ID,
      },
    });
  });
};
