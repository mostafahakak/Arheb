'use strict';

/**
 * Normalize driver/customer mobile input to match DB (Jordan: 0 7XXXXXXXX).
 * Handles 079..., 96279..., +962..., spaces, dashes.
 */
function normalizeJordanMobileKey(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  if (digits.startsWith('962') && digits.length >= 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith('00962') && digits.length >= 14) {
    return `0${digits.slice(5)}`;
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    return digits.slice(0, 11);
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    return `0${digits}`;
  }
  return raw;
}

/**
 * Possible DB keys for the same Jordan number (admin may store 079… or 962…).
 * Used to resolve drivers.mobile regardless of input format.
 */
function jordanMobileLookupKeys(input) {
  const raw = String(input ?? '').trim();
  const keys = new Set();
  const norm = normalizeJordanMobileKey(input);
  if (norm) keys.add(norm);
  if (raw) keys.add(raw);
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('962') && digits.length >= 12) {
    keys.add(digits.slice(0, 12));
  }
  if (norm && norm.startsWith('0') && norm.length >= 10) {
    keys.add(`962${norm.slice(1)}`);
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    keys.add(`0${digits}`);
    keys.add(`962${digits}`);
  }
  return [...keys].filter(Boolean);
}

/** OTP from SMS / paste: digits only (strips spaces / hidden chars). */
function normalizeOtpDigits(otp) {
  return String(otp ?? '').replace(/\D/g, '');
}

module.exports = {
  normalizeJordanMobileKey,
  jordanMobileLookupKeys,
  normalizeOtpDigits,
};
