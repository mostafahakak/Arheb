const crypto = require('crypto');
const axios = require('axios');
const express = require('express');

const PAYTABS_API_URL = 'https://madfoat-secure.paytabs.com';
const PROFILE_ID = 47145;

module.exports = function attachPaymentRoutes(app, db, authenticateRequest) {
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

  function paytabsHeaders() {
    return {
      'authorization': SERVER_KEY,
      'content-type': 'application/json',
    };
  }

  // --- Initiate payment (creates a hosted payment page) ---
  app.post('/api/payment/initiate', authenticateRequest, async (req, res) => {
    try {
      const {
        orderId,
        amount,
        currency,
        description,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        customerCity,
        customerCountry,
      } = req.body || {};

      if (!amount || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ success: false, message: 'amount is required and must be > 0' });
      }

      const cartId = orderId
        ? `ORDER-${orderId}-${Date.now()}`
        : `CART-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const cartCurrency = currency || CART_CURRENCY;
      const cartDescription = description || `Arheb Order ${orderId || cartId}`;

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

      if (customerName || customerEmail || customerPhone) {
        payload.customer_details = {};
        if (customerName) payload.customer_details.name = customerName;
        if (customerEmail) payload.customer_details.email = customerEmail;
        if (customerPhone) payload.customer_details.phone = customerPhone;
        if (customerAddress) payload.customer_details.street1 = customerAddress;
        if (customerCity) payload.customer_details.city = customerCity;
        if (customerCountry) payload.customer_details.country = customerCountry;
      }

      const response = await axios.post(`${PAYTABS_API_URL}/payment/request`, payload, {
        headers: paytabsHeaders(),
        timeout: 30000,
      });

      const data = response.data;

      db.prepare(`
        INSERT INTO payment_transactions (orderId, tranRef, cartId, cartAmount, cartCurrency, tranType, status, redirectUrl, rawResponse)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId || null,
        data.tran_ref || null,
        cartId,
        amount,
        cartCurrency,
        'sale',
        data.redirect_url ? 'pending_redirect' : (data.payment_result?.response_status === 'A' ? 'completed' : 'initiated'),
        data.redirect_url || null,
        JSON.stringify(data),
      );

      if (data.payment_result && data.payment_result.response_status === 'A') {
        if (orderId) {
          try {
            db.prepare("UPDATE orders SET paymentType = 'card_paid', status = 'Waiting confirmation' WHERE id = ?").run(orderId);
          } catch (e) { /* ignore */ }
        }
        return res.status(200).json({
          success: true,
          message: 'Payment completed successfully',
          data: {
            tranRef: data.tran_ref,
            cartId,
            status: 'completed',
            paymentResult: data.payment_result,
            paymentInfo: data.payment_info,
          },
        });
      }

      if (data.redirect_url) {
        return res.status(200).json({
          success: true,
          message: 'Redirect customer to complete payment',
          data: {
            tranRef: data.tran_ref,
            cartId,
            status: 'pending_redirect',
            redirectUrl: data.redirect_url,
            redirectMethod: 'GET',
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Payment request submitted',
        data: {
          tranRef: data.tran_ref,
          cartId,
          rawResponse: data,
        },
      });
    } catch (error) {
      const errData = error.response?.data;
      console.error('Payment initiate error:', errData || error.message);
      return res.status(error.response?.status || 500).json({
        success: false,
        message: errData?.message || error.message || 'Payment request failed',
        code: errData?.code || null,
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

        if (status === 'completed' && existing.orderId) {
          try {
            db.prepare("UPDATE orders SET paymentType = 'card_paid', status = 'Waiting confirmation' WHERE id = ? AND status IN ('Waiting confirmation', 'initiated')").run(existing.orderId);
          } catch (e) { /* ignore */ }
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
      if (existing && existing.status === 'pending_redirect') {
        const status = respStatus === 'A' ? 'completed' : (respStatus === 'D' ? 'declined' : 'unknown');
        db.prepare(`
          UPDATE payment_transactions SET status = ?, responseStatus = ?, responseMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE tranRef = ?
        `).run(status, respStatus || null, respMessage || null, tranRef);
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
