import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n';
import { Button, Card, Field } from '../components/ui';
import { colors, radius, spacing } from '../theme';

export default function AccountScreen({ navigation }) {
  const { admin, logout } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const onChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert(t('error'), t('requiredFields'));
      return;
    }
    setSaving(true);
    try {
      await api.changeMyPassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      Alert.alert(t('passwordChanged'));
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(2) }} keyboardShouldPersistTaps="handled">
      <Card style={styles.section}>
        <Text style={styles.email}>{admin?.email}</Text>
        {!!admin?.role && <Text style={styles.role}>{admin.role}</Text>}
      </Card>

      <Text style={styles.sectionTitle}>{t('language')}</Text>
      <Card style={styles.section}>
        <View style={styles.langRow}>
          <LangPill label={t('english')} active={locale === 'en'} onPress={() => setLocale('en')} />
          <LangPill label={t('arabic')} active={locale === 'ar'} onPress={() => setLocale('ar')} />
        </View>
      </Card>

      <Text style={styles.sectionTitle}>{t('changePassword')}</Text>
      <Card style={styles.section}>
        <Field label={t('currentPassword')} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <Field label={t('newPassword')} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Button title={saving ? t('saving') : t('changePassword')} loading={saving} onPress={onChangePassword} />
      </Card>

      <Text style={styles.sectionTitle}>{t('account')}</Text>
      <Card style={styles.section}>
        <NavRow label={t('arhebBox')} onPress={() => navigation.navigate('ArhebBox')} />
        <NavRow label={t('activityLog')} onPress={() => navigation.navigate('ActivityLog')} last />
      </Card>

      <Button title={t('logout')} variant="secondary" onPress={logout} style={{ marginTop: spacing(1) }} />
    </ScrollView>
  );
}

function LangPill({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function NavRow({ label, onPress, last }) {
  return (
    <Pressable onPress={onPress} style={[styles.navRow, !last && styles.divider]}>
      <Text style={styles.navLabel}>{label}</Text>
      <Text style={styles.navChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  section: { marginBottom: spacing(2) },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.subtext, marginBottom: spacing(1), marginLeft: spacing(0.5), textTransform: 'uppercase' },
  email: { fontSize: 18, fontWeight: '800', color: colors.ink },
  role: { fontSize: 13, color: colors.subtext, marginTop: 4 },
  langRow: { flexDirection: 'row', gap: spacing(1.5) },
  pill: {
    flex: 1,
    paddingVertical: spacing(1.25),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { fontSize: 15, fontWeight: '600', color: colors.subtext },
  pillTextActive: { color: colors.ink },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing(1.5) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  navLabel: { fontSize: 16, color: colors.text },
  navChevron: { fontSize: 22, color: colors.muted },
});
