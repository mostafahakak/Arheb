'use strict';

const crypto = require('crypto');
const axios = require('axios');

const OTP_TTL_MS = 2 * 60 * 1000;
/** Stored pending row TTL when using Twilio Verify (their codes often outlive 2 minutes). */
const TWILIO_VERIFY_PENDING_TTL_MS = Number(process.env.TWILIO_VERIFY_PENDING_TTL_MS) || 10 * 60 * 1000;
const MIN_RESEND_INTERVAL_MS = 45 * 1000;

const { normalizeJordanMobileKey, toAsciiDigits } = require('./jordanMobile');

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

/**
 * International + Jordan: digits for Meta/Twilio OTP (no leading +).
 * @returns {{ digits: string, e164: string } | null}
 */
function resolveOtpDestination(phoneNumber, phoneKey) {
  const j = jordanKeyToWhatsAppDigits(phoneKey);
  if (j) {
    return { digits: j, e164: `+${j}` };
  }
  const d = toAsciiDigits(String(phoneNumber ?? '')).replace(/\D/g, '');
  if (d.length >= 10 && d.length <= 15) {
    return { digits: d, e164: `+${d}` };
  }
  return null;
}

/** DB channel for live app register/verify-otp (Twilio). */
const REGISTER_OTP_CHANNEL = 'register';

/** Twilio Verify delivery: `whatsapp` (default) or `sms` (no WhatsApp Business needed). */
function getTwilioVerifyChannel() {
  const c = (process.env.TWILIO_VERIFY_CHANNEL || 'whatsapp').trim().toLowerCase();
  if (c === 'sms' || c === 'text') return 'sms';
  return 'whatsapp';
}

/** Live POST /api/auth/register — defaults to SMS (same UX as old Firebase Phone OTP). */
function getRegisterOtpChannel() {
  const specific = process.env.TWILIO_REGISTER_OTP_CHANNEL?.trim().toLowerCase();
  if (specific === 'sms' || specific === 'text') return 'sms';
  if (specific === 'whatsapp') return 'whatsapp';
  if (process.env.TWILIO_VERIFY_CHANNEL?.trim()) return getTwilioVerifyChannel();
  return 'sms';
}

/**
 * Clear 503 hint when no provider is configured (safe for clients).
 */
function getWhatsappOtpNotConfiguredHint() {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (sid && !sid.startsWith('VA')) {
    return 'TWILIO_VERIFY_SERVICE_SID must start with VA (Twilio Console → Verify → Services). Do not use Account SID (AC…) here.';
  }
  return 'OTP not configured on server. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID (VA…), or Meta WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID. Use TWILIO_VERIFY_CHANNEL=sms for SMS without WhatsApp.';
}

/**
 * Twilio WhatsApp sender address (E.164 with whatsapp: prefix).
 * @param {string} raw
 * @returns {string}
 */
function normalizeTwilioWhatsAppAddress(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';
  const prefix = 'whatsapp:';
  if (s.toLowerCase().startsWith(prefix)) {
    let rest = s.slice(prefix.length).trim();
    rest = rest.replace(/^\+?/, '');
    return `${prefix}+${rest}`;
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  return `${prefix}+${digits}`;
}

/**
 * @param {string} toDigits e.g. 9627xxxxxxxx (no +)
 */
function jordanDigitsToTwilioWhatsAppTo(toDigits) {
  const d = String(toDigits || '').replace(/\D/g, '');
  if (!d) return '';
  return `whatsapp:+${d}`;
}

/** E.164 for Twilio Verify (`to: "+962..."`). */
function jordanDigitsToE164Plus(toDigits) {
  const d = String(toDigits || '').replace(/\D/g, '');
  if (!d) return '';
  return `+${d}`;
}

function getTwilioVerifyConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  const complete = Boolean(
    accountSid && authToken && serviceSid && serviceSid.startsWith('VA'),
  );
  return {
    complete,
    accountSid,
    authToken,
    serviceSid,
  };
}

function getTwilioWhatsappConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = normalizeTwilioWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM?.trim() || '');
  const contentSid = process.env.TWILIO_WHATSAPP_OTP_CONTENT_SID?.trim();
  const complete = Boolean(accountSid && authToken && from && contentSid);
  return {
    complete,
    accountSid,
    authToken,
    from,
    contentSid,
  };
}

function getMetaWhatsappConfig() {
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
 * Priority: Twilio Verify WhatsApp → Twilio Messaging (Content) → Meta Cloud API.
 * @returns {{ configured: boolean, provider: 'twilio_verify'|'twilio'|'meta'|null } & Record<string, unknown>}
 */
function getWhatsappConfig() {
  const verify = getTwilioVerifyConfig();
  if (verify.complete) {
    return {
      configured: true,
      provider: 'twilio_verify',
      verify,
    };
  }
  const twilio = getTwilioWhatsappConfig();
  if (twilio.complete) {
    return {
      configured: true,
      provider: 'twilio',
      twilio,
    };
  }
  const meta = getMetaWhatsappConfig();
  if (meta.configured) {
    return {
      configured: true,
      provider: 'meta',
      ...meta,
    };
  }
  return {
    configured: false,
    provider: null,
    ...meta,
  };
}

/**
 * Twilio Content API: variable index (string key) that receives the OTP digits.
 * Optional JSON merges extra template variables (string keys/values).
 */
function buildTwilioOtpContentVariables(otpCode) {
  const varKey = process.env.TWILIO_WHATSAPP_OTP_CODE_VAR?.trim() || '1';
  /** @type {Record<string, string>} */
  const vars = { [varKey]: String(otpCode) };
  const extraRaw = process.env.TWILIO_WHATSAPP_OTP_CONTENT_VARIABLES_EXTRAS_JSON?.trim();
  if (extraRaw) {
    try {
      const extra = JSON.parse(extraRaw);
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        for (const [k, v] of Object.entries(extra)) {
          vars[String(k)] = v == null ? '' : String(v);
        }
      }
    } catch (e) {
      console.warn('[whatsapp-otp] TWILIO_WHATSAPP_OTP_CONTENT_VARIABLES_EXTRAS_JSON invalid JSON, ignored');
    }
  }
  vars[varKey] = String(otpCode);
  return JSON.stringify(vars);
}

/**
 * Twilio Verify: send OTP (WhatsApp or SMS — TWILIO_VERIFY_CHANNEL).
 * @param {string} toDigits International digits without + e.g. 9627… or 2012…
 * @see https://www.twilio.com/docs/verify/whatsapp
 * @see https://www.twilio.com/docs/verify/api/verification
 */
async function startTwilioVerifyOtp(toDigits, channel) {
  const v = getTwilioVerifyConfig();
  if (!v.complete) {
    const err = new Error(
      'Twilio Verify is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)',
    );
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }
  const twilioSdk = require('twilio');
  const client = twilioSdk(v.accountSid, v.authToken);
  const to = jordanDigitsToE164Plus(toDigits);
  if (!to) {
    const err = new Error('Invalid phone for Verify');
    err.code = 'INVALID_PHONE';
    throw err;
  }
  const ch = channel === 'sms' ? 'sms' : 'whatsapp';
  const verification = await client.verify.v2.services(v.serviceSid).verifications.create({
    channel: ch,
    to,
  });
  return verification;
}

async function startTwilioVerifyWhatsappOtp(toDigits) {
  return startTwilioVerifyOtp(toDigits, getTwilioVerifyChannel());
}

/**
 * @param {string} toDigits
 * @param {string} code
 * @returns {Promise<boolean>} true if Twilio approved the code
 */
async function checkTwilioVerifyWhatsappOtp(toDigits, code) {
  const v = getTwilioVerifyConfig();
  if (!v.complete) {
    const err = new Error('Twilio Verify is not configured');
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }
  const twilioSdk = require('twilio');
  const client = twilioSdk(v.accountSid, v.authToken);
  const to = jordanDigitsToE164Plus(toDigits);
  const check = await client.verify.v2.services(v.serviceSid).verificationChecks.create({
    to,
    code: String(code).trim(),
  });
  return check.status === 'approved';
}

/** Pending row stores Twilio Verify attempt SID (starts with VE). */
function isTwilioVerifyVerificationId(verificationId) {
  const s = String(verificationId || '');
  return s.startsWith('VE');
}

/**
 * @param {string} toDigits Jordan mobile in digits (962...)
 * @param {string} otpCode
 */
async function sendTwilioWhatsappAuthenticationOtp(toDigits, otpCode) {
  const t = getTwilioWhatsappConfig();
  if (!t.complete) {
    const err = new Error(
      'Twilio WhatsApp OTP is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_OTP_CONTENT_SID)',
    );
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }
  const twilioSdk = require('twilio');
  const client = twilioSdk(t.accountSid, t.authToken);
  const to = jordanDigitsToTwilioWhatsAppTo(toDigits);
  const contentVariables = buildTwilioOtpContentVariables(otpCode);
  /** Optional Messaging Service (MG…); when set, Twilio picks the sender from the pool. */
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const createPayload = {
    to,
    contentSid: t.contentSid,
    contentVariables,
  };
  if (messagingServiceSid && messagingServiceSid.startsWith('MG')) {
    createPayload.messagingServiceSid = messagingServiceSid;
  } else {
    createPayload.from = t.from;
  }
  const message = await client.messages.create(createPayload);
  return { sid: message.sid, status: message.status, provider: 'twilio' };
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

async function sendMetaWhatsappAuthenticationOtp(toDigits, otpCode) {
  const cfg = getMetaWhatsappConfig();
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

async function sendWhatsappAuthenticationOtp(toDigits, otpCode) {
  const top = getWhatsappConfig();
  if (top.provider === 'twilio') {
    return sendTwilioWhatsappAuthenticationOtp(toDigits, otpCode);
  }
  if (top.provider === 'meta') {
    return sendMetaWhatsappAuthenticationOtp(toDigits, otpCode);
  }
  const err = new Error(
    'WhatsApp OTP is not configured. Set Twilio Verify (TWILIO_VERIFY_SERVICE_SID), or Twilio Messaging (TWILIO_WHATSAPP_FROM + TWILIO_WHATSAPP_OTP_CONTENT_SID), or Meta (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID).',
  );
  err.code = 'WHATSAPP_NOT_CONFIGURED';
  throw err;
}

function upsertWhatsappOtp(db, { phoneKey, channel, code, verificationId, now, ttlMs }) {
  ensureWhatsappOtpTable(db);
  const expiresAt = now + (ttlMs ?? OTP_TTL_MS);
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

/**
 * Send OTP for live POST /api/auth/register (Twilio Verify preferred, else Messaging/Meta).
 * Returns sessionInfo string for verify-otp (same contract as legacy Firebase sessionInfo).
 */
async function sendRegisterOtp(db, phoneNumber, phoneKey) {
  const cfg = getWhatsappConfig();
  if (!cfg.configured) {
    const err = new Error(getWhatsappOtpNotConfiguredHint());
    err.code = 'OTP_NOT_CONFIGURED';
    throw err;
  }
  const dest = resolveOtpDestination(phoneNumber, phoneKey);
  if (!dest) {
    const err = new Error('Could not format phone for OTP');
    err.code = 'INVALID_PHONE';
    throw err;
  }

  const now = Date.now();
  const pending = getPendingWhatsappOtp(db, phoneKey, REGISTER_OTP_CHANNEL);
  const cooldown = checkResendCooldown(pending, now);
  if (!cooldown.ok) {
    const err = new Error(`Wait ${cooldown.waitSec}s before requesting another code`);
    err.code = 'RATE_LIMIT';
    err.retryAfterSec = cooldown.waitSec;
    throw err;
  }

  const localVerificationId = generateVerificationId();
  let sessionInfo = localVerificationId;
  let ttlMs = OTP_TTL_MS;

  if (cfg.provider === 'twilio_verify') {
    const channel = getRegisterOtpChannel();
    const verification = await startTwilioVerifyOtp(dest.digits, channel);
    sessionInfo = verification.sid;
    ttlMs = TWILIO_VERIFY_PENDING_TTL_MS;
    upsertWhatsappOtp(db, {
      phoneKey,
      channel: REGISTER_OTP_CHANNEL,
      code: '__twilio_verify__',
      verificationId: verification.sid,
      now,
      ttlMs,
    });
  } else {
    const code = generateOtpCode();
    await sendWhatsappAuthenticationOtp(dest.digits, code);
    upsertWhatsappOtp(db, {
      phoneKey,
      channel: REGISTER_OTP_CHANNEL,
      code,
      verificationId: localVerificationId,
      now,
      ttlMs,
    });
  }

  return { sessionInfo, channel: cfg.provider === 'twilio_verify' ? getRegisterOtpChannel() : 'whatsapp' };
}

/**
 * Verify OTP for live POST /api/auth/verify-otp.
 * @returns {{ phoneKey: string }}
 */
async function verifyRegisterOtp(db, phoneNumber, phoneKey, sessionInfo, otp) {
  const pending = getPendingWhatsappOtp(db, phoneKey, REGISTER_OTP_CHANNEL);
  if (!pending || String(pending.verificationId) !== String(sessionInfo)) {
    const err = new Error('Invalid or expired OTP. Request a new code.');
    err.code = 'INVALID_SESSION';
    throw err;
  }

  const dest = resolveOtpDestination(phoneNumber, phoneKey);
  const otpDigits = dest ? dest.digits : '';

  if (isTwilioVerifyVerificationId(pending.verificationId) && otpDigits) {
    let approved = false;
    try {
      approved = await checkTwilioVerifyWhatsappOtp(otpDigits, otp);
    } catch (e) {
      const err = new Error(e.message || 'Verification check failed');
      err.code = e.code || 'VERIFY_FAILED';
      throw err;
    }
    if (!approved) {
      const err = new Error('Invalid OTP code');
      err.code = 'INVALID_OTP';
      throw err;
    }
  } else {
    const { normalizeOtpDigits } = require('./jordanMobile');
    const otpNorm = normalizeOtpDigits(otp);
    if (otpNorm.length !== 6 || otpNorm !== String(pending.code)) {
      const err = new Error('Invalid OTP code');
      err.code = 'INVALID_OTP';
      throw err;
    }
  }

  deleteWhatsappOtp(db, phoneKey, REGISTER_OTP_CHANNEL);
  return { phoneKey };
}

module.exports = {
  REGISTER_OTP_CHANNEL,
  OTP_TTL_MS,
  TWILIO_VERIFY_PENDING_TTL_MS,
  MIN_RESEND_INTERVAL_MS,
  ensureWhatsappOtpTable,
  generateOtpCode,
  generateVerificationId,
  normalizeJordanMobileKey,
  jordanKeyToWhatsAppDigits,
  resolveOtpDestination,
  getTwilioVerifyChannel,
  getRegisterOtpChannel,
  getWhatsappOtpNotConfiguredHint,
  getWhatsappConfig,
  getTwilioVerifyConfig,
  getTwilioWhatsappConfig,
  getMetaWhatsappConfig,
  buildAuthenticationTemplatePayload,
  startTwilioVerifyOtp,
  startTwilioVerifyWhatsappOtp,
  checkTwilioVerifyWhatsappOtp,
  isTwilioVerifyVerificationId,
  sendWhatsappAuthenticationOtp,
  upsertWhatsappOtp,
  getPendingWhatsappOtp,
  deleteWhatsappOtp,
  checkResendCooldown,
  sendRegisterOtp,
  verifyRegisterOtp,
};
