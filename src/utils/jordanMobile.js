'use strict';

function toAsciiDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/**
 * Normalize driver/customer mobile input to match DB (Jordan: 0 7XXXXXXXX).
 * Handles 079..., 96279..., +962..., spaces, dashes.
 */
function normalizeJordanMobileKey(input) {
  const raw = toAsciiDigits(input).trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  if (digits.startsWith('962') && digits.length >= 12) {
    return `0${digits.slice(3, 12)}`;
  }
  if (digits.startsWith('00962') && digits.length >= 14) {
    return `0${digits.slice(5, 14)}`;
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    return digits.slice(0, 10);
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    return `0${digits}`;
  }
  return raw;
}

/** E.164 for Jordan mobiles (+9627XXXXXXXX) from any common input format. */
function jordanMobileToE164(input) {
  const norm = normalizeJordanMobileKey(input);
  if (norm && norm.startsWith('0') && norm.length >= 10) {
    return `+962${norm.slice(1)}`;
  }
  const raw = toAsciiDigits(input).trim();
  if (raw.startsWith('+')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('962') && digits.length >= 12) {
    return `+${digits.slice(0, 12)}`;
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    return `+962${digits}`;
  }
  return norm ? raw : '';
}

/**
 * Possible DB keys for the same Jordan number (admin may store 079… or 962…).
 * Used to resolve drivers.mobile regardless of input format.
 */
function jordanMobileLookupKeys(input) {
  const raw = toAsciiDigits(input).trim();
  const keys = new Set();
  const norm = normalizeJordanMobileKey(input);
  if (norm) keys.add(norm);
  if (raw) keys.add(raw);
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('962') && digits.length >= 12) {
    const jordan962 = digits.slice(0, 12);
    keys.add(jordan962);
    keys.add(`+${jordan962}`);
  }
  if (norm && norm.startsWith('0') && norm.length >= 10) {
    keys.add(`962${norm.slice(1)}`);
    keys.add(`+962${norm.slice(1)}`);
  }
  if (raw.startsWith('+')) {
    keys.add(raw);
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    keys.add(`0${digits}`);
    keys.add(`962${digits}`);
  }
  return [...keys].filter(Boolean);
}

/** OTP from SMS / paste: digits only (strips spaces / hidden chars). */
function normalizeOtpDigits(otp) {
  return toAsciiDigits(otp).replace(/\D/g, '');
}

module.exports = {
  toAsciiDigits,
  normalizeJordanMobileKey,
  jordanMobileToE164,
  jordanMobileLookupKeys,
  normalizeOtpDigits,
};
