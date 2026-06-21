import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { useLocale, pickName } from '../i18n';
import { Badge, Button, EmptyState, ErrorState, Loader } from '../components/ui';
import { colors, radius, shadow, spacing } from '../theme';
import { money } from '../lib/orders';

export default function ProductsScreen({ navigation }) {
  const { storeId } = useStore();
  const { t, locale } = useLocale();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(
    async (showSpinner = true) => {
      if (!storeId) return;
      if (showSpinner) setLoading(true);
      setError('');
      try {
        const res = await api.getStoreProducts(storeId);
        setProducts(res.data?.products || res.products || []);
      } catch (e) {
        setError(e.message || t('error'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [storeId, t],
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load]),
  );

  const toggleAvailable = async (product, value) => {
    setBusyId(product.id);
    setProducts((list) => list.map((p) => (p.id === product.id ? { ...p, isAvailable: value } : p)));
    try {
      await api.updateProduct(storeId, product.id, { isAvailable: value });
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
      load(false);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (product) => {
    Alert.alert(t('delete'), t('deleteProductConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteProduct(storeId, product.id);
            setProducts((list) => list.filter((p) => p.id !== product.id));
          } catch (e) {
            Alert.alert(t('error'), e.message || t('error'));
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => {
    const available = item.isAvailable !== false;
    return (
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate('ProductForm', { productId: item.id })}
        onLongPress={() => confirmDelete(item)}
      >
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Text style={styles.thumbText}>—</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{pickName(locale, item)}</Text>
          <Text style={styles.price}>{money(item.price)}</Text>
          {!available && <Badge text={t('unavailable')} bg={colors.dangerBg} fg={colors.danger} />}
        </View>
        <Switch
          value={available}
          onValueChange={(v) => toggleAvailable(item, v)}
          disabled={busyId === item.id}
          trackColor={{ true: colors.accent, false: '#d1d5db' }}
          thumbColor="#fff"
        />
      </Pressable>
    );
  };

  if (loading) return <Loader text={t('loading')} />;
  if (error) return <ErrorState text={error} onRetry={() => load()} retryLabel={t('retry')} />;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Button title={`+ ${t('addProduct')}`} small onPress={() => navigation.navigate('ProductForm', {})} />
      </View>
      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        renderItem={renderItem}
        contentContainerStyle={products.length === 0 ? { flex: 1 } : { padding: spacing(2) }}
        ListEmptyComponent={<EmptyState text={t('noProducts')} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false); }} tintColor={colors.ink} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  toolbar: { padding: spacing(2), paddingBottom: 0 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    backgroundColor: '#fff',
    borderRadius: radius.md,
    padding: spacing(1.5),
    marginBottom: spacing(1.5),
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: '#e5e7eb' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbText: { color: colors.muted, fontSize: 20 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  price: { fontSize: 14, color: colors.subtext, marginTop: 2, marginBottom: 2 },
});
