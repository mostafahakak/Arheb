import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, shadow, spacing } from '../theme';

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, loading, disabled, variant = 'primary', small, style }) {
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.primary;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        isDisabled && { opacity: 0.55 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <Text style={[styles.btnText, small && { fontSize: 14 }, { color: v.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const BTN_VARIANTS = {
  primary: { bg: colors.accent, fg: colors.ink, border: colors.accent },
  dark: { bg: colors.ink, fg: '#fff', border: colors.ink },
  secondary: { bg: '#fff', fg: colors.text, border: colors.border },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: '#fecaca' },
  success: { bg: colors.success, fg: '#fff', border: colors.success },
};

export function Field({ label, value, onChangeText, hint, ...rest }) {
  return (
    <View style={styles.field}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        value={value == null ? '' : String(value)}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...rest}
      />
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export function Badge({ text, bg, fg }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg || '#f3f4f6' }]}>
      <Text style={[styles.badgeText, { color: fg || colors.subtext }]}>{text}</Text>
    </View>
  );
}

export function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function Loader({ text }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.ink} size="large" />
      {!!text && <Text style={styles.muted}>{text}</Text>}
    </View>
  );
}

export function EmptyState({ text }) {
  return (
    <View style={styles.center}>
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

export function ErrorState({ text, onRetry, retryLabel }) {
  return (
    <View style={styles.center}>
      <Text style={[styles.muted, { color: colors.danger, marginBottom: spacing(1.5) }]}>{text}</Text>
      {!!onRetry && <Button title={retryLabel || 'Retry'} variant="secondary" small onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing(2),
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  btn: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(2.5),
  },
  btnSmall: { minHeight: 38, paddingHorizontal: spacing(2) },
  btnText: { fontSize: 16, fontWeight: '700' },
  field: { marginBottom: spacing(2) },
  label: { fontSize: 13, fontWeight: '600', color: colors.subtext, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#fff',
  },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing(2),
  },
  rowLabel: { fontSize: 14, color: colors.subtext },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(3) },
  muted: { color: colors.subtext, fontSize: 14, textAlign: 'center', marginTop: spacing(1) },
});

export { styles as uiStyles };
