#!/usr/bin/env node
/**
 * One-time: create an Arabic AUTHENTICATION WhatsApp template for Arheb OTP (2-minute expiry text).
 *
 * Prerequisites:
 * - WhatsApp Business Account ID (WABA): Business Settings → WhatsApp Accounts → ID
 * - System user token with whatsapp_business_management (and messaging after approval)
 *
 * Usage:
 *   WHATSAPP_BUSINESS_ACCOUNT_ID=... WHATSAPP_ACCESS_TOKEN=... node scripts/createWhatsappAuthTemplate.js
 *
 * Then approve the template in WhatsApp Manager if pending.
 * Set WHATSAPP_OTP_TEMPLATE_NAME / WHATSAPP_OTP_LANG in .env to match (defaults: arheb_login_otp_ar / ar).
 */

require('dotenv').config();
const axios = require('axios');

const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WHATSAPP_WABA_ID;
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH = process.env.WHATSAPP_GRAPH_API_VERSION || 'v22.0';
const TEMPLATE_NAME = process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'arheb_login_otp_ar';
const LANG = process.env.WHATSAPP_OTP_LANG || 'ar';

async function main() {
  if (!WABA_ID || !TOKEN) {
    console.error('Set WHATSAPP_BUSINESS_ACCOUNT_ID (or WHATSAPP_WABA_ID) and WHATSAPP_ACCESS_TOKEN');
    process.exit(1);
  }

  const url = `https://graph.facebook.com/${GRAPH}/${WABA_ID}/message_templates`;

  const body = {
    name: TEMPLATE_NAME,
    language: LANG,
    category: 'AUTHENTICATION',
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 2 },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }],
      },
    ],
  };

  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    console.log('Template submitted:', JSON.stringify(res.data, null, 2));
    console.log('\nNext: wait for APPROVED in WhatsApp Manager → Message templates.');
    console.log(`Use env: WHATSAPP_OTP_TEMPLATE_NAME=${TEMPLATE_NAME} WHATSAPP_OTP_LANG=${LANG}`);
  } catch (e) {
    const msg = e.response?.data || e.message;
    console.error('Failed:', JSON.stringify(msg, null, 2));
    console.error(
      '\nIf Graph API rejects this payload, create the same Authentication template manually in WhatsApp Manager (Arabic, OTP copy button, 2 min expiry).',
    );
    process.exit(1);
  }
}

main();
