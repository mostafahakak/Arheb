import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import * as api from '../api';
import { useLocale } from '../i18n';
import { Badge, EmptyState, ErrorState, Loader } from '../components/ui';
import { colors, radius, shadow, spacing, statusColors } from '../theme';
import { money, shortTime } from '../lib/orders';

export default function ArhebBoxScreen() {
  const { t } = useLocale();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const res = await api.getArhebBoxRequests();
      setItems(res.data?.requests || []);
    } catch (e) {
      setError(e.message || t('error'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const renderItem = ({ item }) => {
    const sc = statusColors(item.status);
    const from = item.pickupAddress || item.pickup?.address || item.fromAddress || '';
    const to = item.dropoffAddress || item.dropoff?.address || item.addressName || item.toAddress || '';
    const amount = item.amount ?? item.totalAmount ?? item.deliveryFee;
    return (
      <View style={styles.card}>
        <View style={styles.top}>
          <Text style={styles.id}>#{item.id}</Text>
          <Badge text={item.status || '—'} bg={sc.bg} fg={sc.fg} />
        </View>
        {!!from && <Text style={styles.line}>{t('from')}: {from}</Text>}
        {!!to && <Text style={styles.line}>{t('to')}: {to}</Text>}
        <View style={styles.bottom}>
          {amount != null && <Text style={styles.meta}>{t('amount')}: {money(amount)}</Text>}
          <Text style={styles.time}>{shortTime(item.createdAtJordan || item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  if (loading) return <Loader text={t('loading')} />;
  if (error) return <ErrorState text={error} onRetry={() => load()} retryLabel={t('retry')} />;

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(x) => String(x.id)}
      renderItem={renderItem}
      contentContainerStyle={items.length === 0 ? { flex: 1 } : { padding: spacing(2) }}
      ListEmptyComponent={<EmptyState text={t('noArhebBox')} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false); }} tintColor={colors.ink} />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: '#fff',
    borderRadius: radius.md,
    padding: spacing(2),
    marginBottom: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing(1) },
  id: { fontSize: 16, fontWeight: '800', color: colors.ink },
  line: { fontSize: 14, color: colors.text, marginBottom: 2 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing(1) },
  meta: { fontSize: 13, color: colors.subtext, fontWeight: '600' },
  time: { fontSize: 12, color: colors.muted },
});
