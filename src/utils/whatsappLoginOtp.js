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
/** DB channel for POST /api/driver/send-otp + /api/driver/login (Twilio). */
const DRIVER_LOGIN_OTP_CHANNEL = 'driver_login';
/** DB channel for POST /api/auth/whatsapp/send-code + verify-code. */
const CUSTOMER_WHATSAPP_OTP_CHANNEL = 'customer';
/** DB channel for POST /api/driver/whatsapp/send-otp + login. */
const DRIVER_WHATSAPP_OTP_CHANNEL = 'driver';

function isTwilioOtpConfigured() {
  return getTwilioVerifySmsConfig().complete;
}

function isTwilioWhatsappVerifyConfigured() {
  return getTwilioVerifyWhatsappConfig().complete;
}

/** SMS vs WhatsApp for Twilio Verify — register/driver SMS routes vs WhatsApp login routes. */
function getTwilioDeliveryChannelFor(dbChannel) {
  if (dbChannel === CUSTOMER_WHATSAPP_OTP_CHANNEL || dbChannel === DRIVER_WHATSAPP_OTP_CHANNEL) {
    return 'whatsapp';
  }
  return getRegisterOtpChannel();
}

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
  const waSid = process.env.TWILIO_VERIFY_WHATSAPP_SERVICE_SID?.trim();
  if (waSid && !waSid.startsWith('VA')) {
    return 'TWILIO_VERIFY_WHATSAPP_SERVICE_SID must start with VA (Twilio Console → Verify → Services with WhatsApp enabled). Do not use Account SID (AC…) or Messaging Service (MG…).';
  }
  const smsSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (smsSid && !smsSid.startsWith('VA')) {
    return 'TWILIO_VERIFY_SERVICE_SID must start with VA (Twilio Console → Verify → Services). Do not use Account SID (AC…) here.';
  }
  return 'WhatsApp OTP not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_WHATSAPP_SERVICE_SID (VA…, WhatsApp channel enabled), or Meta WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID.';
}

function getSmsOtpNotConfiguredHint() {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (sid && !sid.startsWith('VA')) {
    return 'TWILIO_VERIFY_SERVICE_SID must start with VA (Twilio Console → Verify → Services). Do not use Account SID (AC…) here.';
  }
  return 'SMS OTP not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID (VA…), and TWILIO_REGISTER_OTP_CHANNEL=sms.';
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

function getTwilioVerifySmsConfig() {
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

/** Separate Verify service for WhatsApp OTP (/api/auth/whatsapp/*, /api/driver/whatsapp/*). */
function getTwilioVerifyWhatsappConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = process.env.TWILIO_VERIFY_WHATSAPP_SERVICE_SID?.trim();
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

/** @deprecated use getTwilioVerifySmsConfig — kept for exports */
function getTwilioVerifyConfig() {
  return getTwilioVerifySmsConfig();
}

function getTwilioVerifyConfigForChannel(dbChannel) {
  if (dbChannel === CUSTOMER_WHATSAPP_OTP_CHANNEL || dbChannel === DRIVER_WHATSAPP_OTP_CHANNEL) {
    return getTwilioVerifyWhatsappConfig();
  }
  return getTwilioVerifySmsConfig();
}

function getSmsOtpConfig() {
  const verify = getTwilioVerifySmsConfig();
  if (verify.complete) {
    return { configured: true, provider: 'twilio_verify', verify };
  }
  return { configured: false, provider: null };
}

function getTwilioWhatsappConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = normalizeTwilioWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM?.trim() || '');
  const contentSid = process.env.TWILIO_WHATSAPP_OTP_CONTENT_SID?.trim();
  const messagingServiceSid = process.env.TWILIO_WHATSAPP_MESSAGING_SERVICE_SID?.trim();
  const hasWhatsappSender = from || (messagingServiceSid && messagingServiceSid.startsWith('MG'));
  const complete = Boolean(accountSid && authToken && hasWhatsappSender && contentSid);
  return {
    complete,
    accountSid,
    authToken,
    from,
    contentSid,
    messagingServiceSid,
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
 * Priority: WhatsApp-only Twilio Messaging → Twilio Verify WhatsApp → Meta Cloud API.
 * Messaging is preferred when TWILIO_WHATSAPP_MESSAGING_SERVICE_SID is set because
 * Verify can fall back to SMS depending on the Twilio service configuration.
 * @returns {{ configured: boolean, provider: 'twilio_verify'|'twilio'|'meta'|null } & Record<string, unknown>}
 */
function getWhatsappConfig() {
  const twilio = getTwilioWhatsappConfig();
  if (twilio.complete && twilio.messagingServiceSid) {
    return {
      configured: true,
      provider: 'twilio',
      twilio,
    };
  }
  const verify = getTwilioVerifyWhatsappConfig();
  if (verify.complete) {
    return {
      configured: true,
      provider: 'twilio_verify',
      verify,
    };
  }
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
async function startTwilioVerifyOtp(toDigits, channel, verifyConfig) {
  const v = verifyConfig || getTwilioVerifySmsConfig();
  if (!v.complete) {
    const err = new Error(
      'Twilio Verify is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and Verify Service SID VA…)',
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
  return startTwilioVerifyOtp(toDigits, 'whatsapp', getTwilioVerifyWhatsappConfig());
}

/**
 * @param {string} toDigits
 * @param {string} code
 * @param {ReturnType<typeof getTwilioVerifyWhatsappConfig>} [verifyConfig]
 * @returns {Promise<boolean>} true if Twilio approved the code
 */
async function checkTwilioVerifyWhatsappOtp(toDigits, code, verifyConfig) {
  const v = verifyConfig || getTwilioVerifyWhatsappConfig();
  if (!v.complete) {
    const err = new Error('Twilio Verify WhatsApp is not configured (TWILIO_VERIFY_WHATSAPP_SERVICE_SID)');
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
      'Twilio WhatsApp OTP is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_OTP_CONTENT_SID, and TWILIO_WHATSAPP_MESSAGING_SERVICE_SID or TWILIO_WHATSAPP_FROM)',
    );
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }
  const twilioSdk = require('twilio');
  const client = twilioSdk(t.accountSid, t.authToken);
  const to = jordanDigitsToTwilioWhatsAppTo(toDigits);
  const contentVariables = buildTwilioOtpContentVariables(otpCode);
  /**
   * Prefer a WhatsApp-specific Messaging Service so SMS can keep using
   * TWILIO_MESSAGING_SERVICE_SID without leaking into WhatsApp fallback sends.
   */
  const messagingServiceSid =
    t.messagingServiceSid ||
    process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
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
    'WhatsApp OTP is not configured. Set Twilio Verify (TWILIO_VERIFY_WHATSAPP_SERVICE_SID), or Twilio Messaging (TWILIO_WHATSAPP_MESSAGING_SERVICE_SID + TWILIO_WHATSAPP_FROM + TWILIO_WHATSAPP_OTP_CONTENT_SID), or Meta (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID).',
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
 * Send OTP via Twilio Verify (preferred) or Messaging/Meta fallback.
 * @param {string} channel DB channel key (register, driver_login, driver, customer, …)
 * @returns {{ sessionInfo: string, channel: string, expiresInSec: number, otpProvider: 'twilio' }}
 */
async function sendPhoneLoginOtp(db, phoneNumber, phoneKey, channel) {
  const isWhatsappRoute =
    channel === CUSTOMER_WHATSAPP_OTP_CHANNEL || channel === DRIVER_WHATSAPP_OTP_CHANNEL;
  const cfg = isWhatsappRoute ? getWhatsappConfig() : getSmsOtpConfig();
  if (!cfg.configured) {
    const err = new Error(isWhatsappRoute ? getWhatsappOtpNotConfiguredHint() : getSmsOtpNotConfiguredHint());
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
  const pending = getPendingWhatsappOtp(db, phoneKey, channel);
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
  let deliveryChannel = 'whatsapp';

  if (cfg.provider === 'twilio_verify') {
    deliveryChannel = getTwilioDeliveryChannelFor(channel);
    const verification = await startTwilioVerifyOtp(dest.digits, deliveryChannel, cfg.verify);
    sessionInfo = verification.sid;
    ttlMs = TWILIO_VERIFY_PENDING_TTL_MS;
    upsertWhatsappOtp(db, {
      phoneKey,
      channel,
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
      channel,
      code,
      verificationId: localVerificationId,
      now,
      ttlMs,
    });
  }

  return {
    sessionInfo,
    channel: cfg.provider === 'twilio_verify' ? deliveryChannel : 'whatsapp',
    expiresInSec: Math.floor(ttlMs / 1000),
    otpProvider: 'twilio',
  };
}

/**
 * Verify OTP sent via sendPhoneLoginOtp.
 * @returns {{ phoneKey: string }}
 */
async function verifyPhoneLoginOtp(db, phoneNumber, phoneKey, sessionInfo, otp, channel) {
  const pending = getPendingWhatsappOtp(db, phoneKey, channel);
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
      const verifyCfg = getTwilioVerifyConfigForChannel(channel);
      approved = await checkTwilioVerifyWhatsappOtp(otpDigits, otp, verifyCfg);
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

  deleteWhatsappOtp(db, phoneKey, channel);
  return { phoneKey };
}

/**
 * Send OTP for live POST /api/auth/register (Twilio Verify preferred, else Messaging/Meta).
 * Returns sessionInfo string for verify-otp (same contract as legacy Firebase sessionInfo).
 */
async function sendRegisterOtp(db, phoneNumber, phoneKey) {
  return sendPhoneLoginOtp(db, phoneNumber, phoneKey, REGISTER_OTP_CHANNEL);
}

async function sendDriverLoginOtp(db, phoneNumber, phoneKey) {
  return sendPhoneLoginOtp(db, phoneNumber, phoneKey, DRIVER_LOGIN_OTP_CHANNEL);
}

/**
 * Verify OTP for live POST /api/auth/verify-otp.
 * @returns {{ phoneKey: string }}
 */
async function verifyRegisterOtp(db, phoneNumber, phoneKey, sessionInfo, otp) {
  return verifyPhoneLoginOtp(db, phoneNumber, phoneKey, sessionInfo, otp, REGISTER_OTP_CHANNEL);
}

async function verifyDriverLoginOtp(db, phoneNumber, phoneKey, verificationId, otp) {
  return verifyPhoneLoginOtp(db, phoneNumber, phoneKey, verificationId, otp, DRIVER_LOGIN_OTP_CHANNEL);
}

async function sendCustomerWhatsappLoginOtp(db, phoneNumber, phoneKey) {
  return sendPhoneLoginOtp(db, phoneNumber, phoneKey, CUSTOMER_WHATSAPP_OTP_CHANNEL);
}

async function verifyCustomerWhatsappLoginOtp(db, phoneNumber, phoneKey, verificationId, otp) {
  return verifyPhoneLoginOtp(db, phoneNumber, phoneKey, verificationId, otp, CUSTOMER_WHATSAPP_OTP_CHANNEL);
}

async function sendDriverWhatsappLoginOtp(db, phoneNumber, phoneKey) {
  return sendPhoneLoginOtp(db, phoneNumber, phoneKey, DRIVER_WHATSAPP_OTP_CHANNEL);
}

async function verifyDriverWhatsappLoginOtp(db, phoneNumber, phoneKey, verificationId, otp) {
  return verifyPhoneLoginOtp(db, phoneNumber, phoneKey, verificationId, otp, DRIVER_WHATSAPP_OTP_CHANNEL);
}

module.exports = {
  REGISTER_OTP_CHANNEL,
  DRIVER_LOGIN_OTP_CHANNEL,
  CUSTOMER_WHATSAPP_OTP_CHANNEL,
  DRIVER_WHATSAPP_OTP_CHANNEL,
  isTwilioOtpConfigured,
  isTwilioWhatsappVerifyConfigured,
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
  getSmsOtpNotConfiguredHint,
  getWhatsappConfig,
  getSmsOtpConfig,
  getTwilioVerifyConfig,
  getTwilioVerifySmsConfig,
  getTwilioVerifyWhatsappConfig,
  getTwilioVerifyConfigForChannel,
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
  sendPhoneLoginOtp,
  verifyPhoneLoginOtp,
  sendDriverLoginOtp,
  verifyDriverLoginOtp,
  sendCustomerWhatsappLoginOtp,
  verifyCustomerWhatsappLoginOtp,
  sendDriverWhatsappLoginOtp,
  verifyDriverWhatsappLoginOtp,
};
