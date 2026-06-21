import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import * as api from '../api';
import { useLocale } from '../i18n';
import { EmptyState, ErrorState, Loader } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { shortTime } from '../lib/orders';

export default function ActivityLogScreen() {
  const { t } = useLocale();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const res = await api.getActivityLog({ page: 1, perPage: 50 });
      setItems(res.data?.activities || []);
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

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.summary}>{item.summary || `${item.action} ${item.resourceType}`}</Text>
      <Text style={styles.meta}>{shortTime(item.createdAt)}</Text>
    </View>
  );

  if (loading) return <Loader text={t('loading')} />;
  if (error) return <ErrorState text={error} onRetry={() => load()} retryLabel={t('retry')} />;

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(x) => String(x.id)}
      renderItem={renderItem}
      contentContainerStyle={items.length === 0 ? { flex: 1 } : { padding: spacing(2) }}
      ListEmptyComponent={<EmptyState text={t('noActivity')} />}
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
  },
  summary: { fontSize: 15, color: colors.text, marginBottom: spacing(0.5) },
  meta: { fontSize: 12, color: colors.muted },
});
