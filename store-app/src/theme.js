export const colors = {
  accent: '#dbe120',
  accentDark: '#b8bd16',
  ink: '#111827',
  text: '#1f2937',
  subtext: '#6b7280',
  muted: '#9ca3af',
  border: '#e5e7eb',
  bg: '#f3f4f6',
  card: '#ffffff',
  success: '#059669',
  successBg: '#ecfdf5',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  warning: '#d97706',
  warningBg: '#fffbeb',
  info: '#2563eb',
  infoBg: '#eff6ff',
};

export const spacing = (n) => n * 8;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

/** Map an order status to a badge color set. */
export function statusColors(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('cancel') || s.includes('reject')) return { bg: colors.dangerBg, fg: colors.danger };
  if (s.includes('deliver') || s.includes('complete')) return { bg: colors.successBg, fg: colors.success };
  if (s.includes('way') || s.includes('pick') || s.includes('progress')) return { bg: colors.infoBg, fg: colors.info };
  if (s.includes('prepar')) return { bg: colors.warningBg, fg: colors.warning };
  return { bg: '#f3f4f6', fg: colors.subtext };
}
