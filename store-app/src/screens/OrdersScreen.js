import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import * as api from '../api';
import { useLocale } from '../i18n';
import { Badge, EmptyState, ErrorState, Loader } from '../components/ui';
import { colors, radius, shadow, spacing, statusColors } from '../theme';
import { grandTotal, money, shortTime, formatPaymentType } from '../lib/orders';

const SEGMENTS = [
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

export default function OrdersScreen({ navigation }) {
  const { t } = useLocale();
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [segment, setSegment] = useState('active');

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError('');
      try {
        const params = { orderType: 'store', allDates: true };
        if (segment !== 'all') params.statusFilter = segment;
        const [ordersRes, countsRes] = await Promise.all([
          api.getOrders(params),
          api.getOrdersCounts({ allDates: true }).catch(() => null),
        ]);
        setOrders(ordersRes.data?.orders || []);
        if (countsRes) setCounts(countsRes.data || null);
      } catch (e) {
        setError(e.message || t('error'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [segment, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load(false);
  };

  const segmentCount = (key) => {
    if (!counts) return null;
    if (key === 'active') return counts.active;
    if (key === 'delivered') return counts.delivered;
    if (key === 'cancelled') return counts.cancelled;
    return null;
  };

  const renderItem = ({ item }) => {
    const sc = statusColors(item.status);
    const itemCount = (item.items || []).reduce((n, it) => n + (Number(it.quantity) || 0), 0);
    const hasDriver = item.driverId != null && item.driverId !== '';
    return (
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id, orderType: item.orderType || 'store' })}
      >
        <View style={styles.cardTop}>
          <Text style={styles.orderId}>#{item.id}</Text>
          <Badge text={item.status} bg={sc.bg} fg={sc.fg} />
        </View>
        <Text style={styles.customer} numberOfLines={1}>{item.name || '—'}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {itemCount} {t('items')} · {money(grandTotal(item))} · {formatPaymentType(item.paymentType, t)}
        </Text>
        <View style={styles.cardBottom}>
          <Text style={styles.driver} numberOfLines={1}>
            {hasDriver ? `🛵 ${item.driverName || t('driver')}` : t('noDriver')}
          </Text>
          <Text style={styles.time}>{shortTime(item.createdAtJordan || item.createdAt)}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.segments}>
        {SEGMENTS.map((s) => {
          const active = segment === s.key;
          const c = segmentCount(s.key);
          return (
            <Pressable
              key={s.key}
              onPress={() => setSegment(s.key)}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {s.label}{c != null ? ` (${c})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <Loader text={t('loading')} />
      ) : error ? (
        <ErrorState text={error} onRetry={() => load()} retryLabel={t('retry')} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => String(o.id) + (o.orderType || '')}
          renderItem={renderItem}
          contentContainerStyle={orders.length === 0 ? { flex: 1 } : { padding: spacing(2) }}
          ListEmptyComponent={<EmptyState text={t('noOrders')} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  segments: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(1),
    gap: spacing(0.75),
  },
  segment: {
    flex: 1,
    paddingVertical: spacing(0.9),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { fontSize: 12, color: colors.subtext, fontWeight: '700' },
  segmentTextActive: { color: colors.ink },
  card: {
    backgroundColor: '#fff',
    borderRadius: radius.md,
    padding: spacing(2),
    marginBottom: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing(0.5) },
  orderId: { fontSize: 16, fontWeight: '800', color: colors.ink },
  customer: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  sub: { fontSize: 13, color: colors.subtext, marginBottom: spacing(1) },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  driver: { fontSize: 12, color: colors.subtext, flexShrink: 1, paddingRight: spacing(1) },
  time: { fontSize: 12, color: colors.muted },
});
