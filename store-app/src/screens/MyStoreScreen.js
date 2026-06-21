import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';
import { useLocale, pickName } from '../i18n';
import { Badge, Button, Card, ErrorState, Field, Loader, Row } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { registerForStoreNotifications } from '../lib/notifications';

export default function MyStoreScreen() {
  const { store, storeId, loading, error, reload, setStore } = useStore();
  const { logout } = useAuth();
  const { t, locale } = useLocale();
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingHours, setEditingHours] = useState(false);
  const [openingTime, setOpeningTime] = useState('');
  const [closingTime, setClosingTime] = useState('');

  useEffect(() => {
    if (store) {
      setOpeningTime(store.openingTime || '');
      setClosingTime(store.closingTime || '');
    }
  }, [store]);

  useEffect(() => {
    if (storeId) registerForStoreNotifications(storeId);
  }, [storeId]);

  const patch = async (body, optimistic) => {
    if (!storeId) return;
    setSaving(true);
    if (optimistic) setStore((s) => ({ ...s, ...optimistic }));
    try {
      const res = await api.updateStore(storeId, body);
      if (res.data?.store) setStore(res.data.store);
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
      reload();
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const toggleOpen = (value) => {
    // value = switch "open". Use paused flag (paused = !open) plus isOpen.
    patch({ paused: !value, isOpen: value }, { paused: !value, isOpen: value });
  };

  const togglePayment = (key, value) => {
    const current = store?.paymentMethods || { cod: true, card: true, cliq: true, visaondelivery: true };
    const next = { ...current, [key]: value };
    patch({ paymentMethods: next }, { paymentMethods: next });
  };

  const saveHours = () => {
    patch(
      { openingTime: openingTime || null, closingTime: closingTime || null },
      { openingTime, closingTime },
    );
    setEditingHours(false);
  };

  if (loading) return <Loader text={t('loading')} />;
  if (error || !store) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ErrorState text={error || t('error')} onRetry={reload} retryLabel={t('retry')} />
      </SafeAreaView>
    );
  }

  const pm = store.paymentMethods || { cod: true, card: true, cliq: true, visaondelivery: true };
  const isOpen = store.paused !== true && store.isOpen !== false;
  const statusLabel = store.paused ? t('paused') : store.isOpen === false ? t('closed') : t('open');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing(2) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}
      >
        <View style={styles.header}>
          {!!store.logo && <Image source={{ uri: store.logo }} style={styles.logo} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.storeName}>{pickName(locale, store)}</Text>
            <Badge
              text={statusLabel}
              bg={isOpen ? colors.successBg : colors.dangerBg}
              fg={isOpen ? colors.success : colors.danger}
            />
          </View>
        </View>

        <Card style={styles.section}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>{isOpen ? t('storeOpen') : t('storePaused')}</Text>
              <Text style={styles.switchHint}>{t('pauseStore')}</Text>
            </View>
            <Switch
              value={isOpen}
              onValueChange={toggleOpen}
              disabled={saving}
              trackColor={{ true: colors.accent, false: '#d1d5db' }}
              thumbColor="#fff"
            />
          </View>
        </Card>

        <Text style={styles.sectionTitle}>{t('paymentMethods')}</Text>
        <Card style={styles.section}>
          <PaymentToggle label={t('cod')} value={pm.cod !== false} disabled={saving} onChange={(v) => togglePayment('cod', v)} />
          <PaymentToggle label={t('card')} value={pm.card !== false} disabled={saving} onChange={(v) => togglePayment('card', v)} />
          <PaymentToggle label={t('cliq')} value={pm.cliq !== false} disabled={saving} onChange={(v) => togglePayment('cliq', v)} />
          <PaymentToggle label={t('visaOnDelivery')} value={pm.visaondelivery !== false} disabled={saving} onChange={(v) => togglePayment('visaondelivery', v)} last />
        </Card>

        <Text style={styles.sectionTitle}>{t('storeDetails')}</Text>
        <Card style={styles.section}>
          {editingHours ? (
            <View>
              <Field label={t('openingTime')} value={openingTime} onChangeText={setOpeningTime} placeholder="09:00" />
              <Field label={t('closingTime')} value={closingTime} onChangeText={setClosingTime} placeholder="23:00" />
              <View style={{ flexDirection: 'row', gap: spacing(1) }}>
                <Button title={t('save')} small loading={saving} onPress={saveHours} style={{ flex: 1 }} />
                <Button title={t('cancel')} small variant="secondary" onPress={() => setEditingHours(false)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <View>
              <Row label={t('openingTime')} value={store.openingTime || '—'} />
              <Row label={t('closingTime')} value={store.closingTime || '—'} />
              <Button title={t('edit')} small variant="secondary" onPress={() => setEditingHours(true)} style={{ marginTop: spacing(1.5) }} />
            </View>
          )}
        </Card>

        <Button title={t('logout')} variant="secondary" onPress={logout} style={{ marginTop: spacing(2) }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PaymentToggle({ label, value, onChange, disabled, last }) {
  return (
    <View style={[styles.switchRow, !last && styles.divider]}>
      <Text style={styles.paymentLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: '#d1d5db' }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(2) },
  logo: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: '#e5e7eb' },
  storeName: { fontSize: 22, fontWeight: '800', color: colors.ink, marginBottom: spacing(1) },
  section: { marginBottom: spacing(2) },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.subtext, marginBottom: spacing(1), marginLeft: spacing(0.5), textTransform: 'uppercase' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing(1) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  switchLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  switchHint: { fontSize: 13, color: colors.muted, marginTop: 2 },
  paymentLabel: { fontSize: 16, color: colors.text },
});
