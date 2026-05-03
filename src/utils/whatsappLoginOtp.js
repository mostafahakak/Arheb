'use strict';

const crypto = require('crypto');
const axios = require('axios');

const OTP_TTL_MS = 2 * 60 * 1000;
const MIN_RESEND_INTERVAL_MS = 45 * 1000;

const { normalizeJordanMobileKey } = require('./jordanMobile');

function ensureWhatsappOtpTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_otp_pending (
      phone_key TEXT NOT NULL,
      channel TEXT NOT NULL,
      code TEXT NOT NULL,
      verification_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      last_sent_at INTEGER NOT NULL,
      PRIMARY KEY (phone_key, channel)
    )
  `);
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function generateVerificationId() {
  return crypto.randomUUID();
}

function jordanKeyToWhatsAppDigits(jordanKey) {
  const norm = normalizeJordanMobileKey(jordanKey);
  const digits = String(norm || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length >= 10) {
    return `962${digits.slice(1)}`;
  }
  if (digits.startsWith('962') && digits.length >= 12) {
    return digits.slice(0, 12);
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    return `962${digits}`;
  }
  return '';
}

function getWhatsappConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim() || 'arheb_login_otp_ar';
  const templateLang = process.env.WHATSAPP_OTP_LANG?.trim() || 'ar';
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v22.0';
  const includeButton =
    process.env.WHATSAPP_OTP_INCLUDE_BUTTON !== '0' &&
    process.env.WHATSAPP_OTP_INCLUDE_BUTTON !== 'false';

  return {
    configured: Boolean(accessToken && phoneNumberId),
    accessToken,
    phoneNumberId,
    templateName,
    templateLang,
    graphVersion,
    includeButton,
  };
}

/**
 * Build Cloud API template payload for Meta authentication OTP (Arabic template).
 * Many auth templates need body text param + copy-code button param (same OTP).
 */
function buildAuthenticationTemplatePayload(toDigits, otpCode, cfg) {
  const components = [
    {
      type: 'body',
      parameters: [{ type: 'text', text: String(otpCode) }],
    },
  ];
  if (cfg.includeButton) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: String(otpCode) }],
    });
  }
  return {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'template',
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLang },
      components,
    },
  };
}

async function sendWhatsappAuthenticationOtp(toDigits, otpCode) {
  const cfg = getWhatsappConfig();
  if (!cfg.configured) {
    const err = new Error('WhatsApp OTP is not configured (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)');
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const payload = buildAuthenticationTemplatePayload(toDigits, otpCode, cfg);
  const res = await axios.post(url, payload, {
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

function upsertWhatsappOtp(db, { phoneKey, channel, code, verificationId, now }) {
  ensureWhatsappOtpTable(db);
  const expiresAt = now + OTP_TTL_MS;
  db.prepare(
    `INSERT INTO whatsapp_otp_pending (phone_key, channel, code, verification_id, expires_at, last_sent_at)
     VALUES (@phone_key, @channel, @code, @verification_id, @expires_at, @last_sent_at)
     ON CONFLICT(phone_key, channel) DO UPDATE SET
       code = excluded.code,
       verification_id = excluded.verification_id,
       expires_at = excluded.expires_at,
       last_sent_at = excluded.last_sent_at`,
  ).run({
    phone_key: phoneKey,
    channel,
    code,
    verification_id: verificationId,
    expires_at: expiresAt,
    last_sent_at: now,
  });
  return { verificationId, expiresAt };
}

function getPendingWhatsappOtp(db, phoneKey, channel) {
  ensureWhatsappOtpTable(db);
  const row = db
    .prepare('SELECT * FROM whatsapp_otp_pending WHERE phone_key = ? AND channel = ?')
    .get(phoneKey, channel);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM whatsapp_otp_pending WHERE phone_key = ? AND channel = ?').run(phoneKey, channel);
    return null;
  }
  return {
    code: row.code,
    verificationId: row.verification_id,
    expiresAt: row.expires_at,
    lastSentAt: row.last_sent_at,
  };
}

function deleteWhatsappOtp(db, phoneKey, channel) {
  db.prepare('DELETE FROM whatsapp_otp_pending WHERE phone_key = ? AND channel = ?').run(phoneKey, channel);
}

/** @returns {{ ok: boolean, waitSec?: number }} */
function checkResendCooldown(pending, now) {
  if (!pending) return { ok: true };
  const elapsed = now - pending.lastSentAt;
  if (elapsed < MIN_RESEND_INTERVAL_MS) {
    return { ok: false, waitSec: Math.ceil((MIN_RESEND_INTERVAL_MS - elapsed) / 1000) };
  }
  return { ok: true };
}

module.exports = {
  OTP_TTL_MS,
  MIN_RESEND_INTERVAL_MS,
  ensureWhatsappOtpTable,
  generateOtpCode,
  generateVerificationId,
  normalizeJordanMobileKey,
  jordanKeyToWhatsAppDigits,
  getWhatsappConfig,
  buildAuthenticationTemplatePayload,
  sendWhatsappAuthenticationOtp,
  upsertWhatsappOtp,
  getPendingWhatsappOtp,
  deleteWhatsappOtp,
  checkResendCooldown,
};
