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

/** OTP from SMS / paste: digits only (strips spaces / hidden chars). */
function normalizeOtpDigits(otp) {
  return String(otp ?? '').replace(/\D/g, '');
}

module.exports = {
  normalizeJordanMobileKey,
  normalizeOtpDigits,
};
