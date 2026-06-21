import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n';
import { Badge, Button, Card, ErrorState, Loader, Row } from '../components/ui';
import { colors, radius, spacing, statusColors } from '../theme';
import {
  canManageDrivers,
  canRejectOrder,
  canReassignDriver,
  getDetailStatusOptions,
  grandTotal,
  formatPaymentType,
  isPreparingAndUnassigned,
  isStoreAdminRole,
  itemsSubtotal,
  money,
  normalizeStatusKey,
  shortTime,
} from '../lib/orders';
import { printOrderReceipt } from '../lib/receipt';

export default function OrderDetailScreen({ route, navigation }) {
  const { orderId, orderType } = route.params || {};
  const { admin } = useAuth();
  const role = admin?.role;
  const storeAdmin = isStoreAdminRole(role);
  const driversAllowed = canManageDrivers(role) && orderType !== 'arheb_box';
  const { t } = useLocale();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [drivers, setDrivers] = useState([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [nearby, setNearby] = useState([]);
  const [reassignOpen, setReassignOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getOrder(orderId, orderType);
      setOrder(res.data?.order || null);
    } catch (e) {
      setError(e.message || t('error'));
    } finally {
      setLoading(false);
    }
  }, [orderId, orderType, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (driversAllowed) {
      api.getDrivers().then((res) => setDrivers(res.data?.drivers || [])).catch(() => setDrivers([]));
    }
  }, [driversAllowed]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: `${t('order')} #${orderId}` });
  }, [navigation, orderId, t]);

  const refreshOrder = async () => {
    try {
      const res = await api.getOrder(orderId, orderType);
      setOrder(res.data?.order || null);
    } catch (e) {
      /* ignore */
    }
  };

  const onPrint = async () => {
    setPrinting(true);
    try {
      await printOrderReceipt(order, role);
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
    } finally {
      setPrinting(false);
    }
  };

  const changeStatus = async (status) => {
    setWorking(true);
    try {
      await api.updateOrderStatus(orderId, status);
      await refreshOrder();
      if (normalizeStatusKey(status) === 'preparing') {
        printOrderReceipt({ ...order, status }, role).catch(() => {});
      }
      Alert.alert(t('updated'), `${t('status')}: ${status}`);
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
    } finally {
      setWorking(false);
    }
  };

  const confirmReject = () => {
    Alert.alert(t('rejectOrder'), `#${orderId}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('rejectOrder'),
        style: 'destructive',
        onPress: async () => {
          setWorking(true);
          try {
            await api.rejectOrder(orderId);
            await refreshOrder();
            Alert.alert(t('rejected'), `#${orderId}`);
          } catch (e) {
            Alert.alert(t('error'), e.message || t('error'));
          } finally {
            setWorking(false);
          }
        },
      },
    ]);
  };

  const openAssign = async () => {
    setAssignOpen(true);
    setNearby([]);
    try {
      const res = await api.getOrderNearbyDrivers(orderId);
      let list = res.data?.drivers || [];
      if (!list.length) {
        const r = await api.getOrderAvailableDrivers(orderId);
        list = r.data?.drivers || [];
      }
      setNearby(list);
    } catch (e) {
      try {
        const r = await api.getOrderAvailableDrivers(orderId);
        setNearby(r.data?.drivers || []);
      } catch (_) {
        setNearby([]);
      }
    }
  };

  const offerNearest = async () => {
    setWorking(true);
    try {
      await api.requestDriver(orderId);
      setAssignOpen(false);
      await refreshOrder();
      Alert.alert(t('requestSent'));
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
    } finally {
      setWorking(false);
    }
  };

  const autoAssign = async () => {
    setWorking(true);
    try {
      await api.autoAssignDriver(orderId);
      setAssignOpen(false);
      await refreshOrder();
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
    } finally {
      setWorking(false);
    }
  };

  const reassignTo = async (driverId) => {
    setWorking(true);
    try {
      await api.reassignOrderDriver(orderId, driverId);
      setReassignOpen(false);
      await refreshOrder();
      Alert.alert(t('updated'));
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
    } finally {
      setWorking(false);
    }
  };

  const openMap = () => {
    const lat = order.addressLat ?? order.latitude;
    const lng = order.addressLong ?? order.longitude;
    if (lat == null || lng == null) return;
    Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`);
  };

  if (loading) return <Loader text={t('loading')} />;
  if (error) return <ErrorState text={error} onRetry={load} retryLabel={t('retry')} />;
  if (!order) return <ErrorState text={t('error')} onRetry={load} retryLabel={t('retry')} />;

  const sc = statusColors(order.status);
  const items = order.items || [];
  const statusOptions = getDetailStatusOptions(role, order.status).filter(
    (s) => normalizeStatusKey(s) !== normalizeStatusKey(order.status),
  );
  const showReject = canRejectOrder(role, order.status);
  const hasDriver = order.driverId != null && order.driverId !== '';
  const hasMap = (order.addressLat ?? order.latitude) != null && (order.addressLong ?? order.longitude) != null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(2) }}>
      <Card style={{ marginBottom: spacing(2) }}>
        <View style={styles.headerRow}>
          <Text style={styles.orderId}>#{order.id}</Text>
          <Badge text={order.status} bg={sc.bg} fg={sc.fg} />
        </View>
        <Text style={styles.time}>{shortTime(order.createdAtJordan || order.createdAt)}</Text>
        <Button
          title={printing ? t('printing') : t('printOrder')}
          onPress={onPrint}
          loading={printing}
          style={{ marginTop: spacing(1.5) }}
        />
      </Card>

      <Text style={styles.sectionTitle}>{t('customer')}</Text>
      <Card style={{ marginBottom: spacing(2) }}>
        <Row label={t('customer')} value={order.name || '—'} />
        <Row label={t('phone')} value={order.phoneNumber || '—'} />
        <Row label={t('address')} value={order.addressName || '—'} />
        {!!order.notes && <Row label={t('notes')} value={order.notes} />}
        {hasMap && (
          <Button title={t('openInMaps')} variant="secondary" small onPress={openMap} style={{ marginTop: spacing(1.5) }} />
        )}
      </Card>

      <Text style={styles.sectionTitle}>{t('items')}</Text>
      <Card style={{ marginBottom: spacing(2) }}>
        {items.length === 0 ? (
          <Text style={styles.muted}>—</Text>
        ) : (
          items.map((it, idx) => (
            <View key={idx} style={[styles.itemRow, idx < items.length - 1 && styles.itemDivider]}>
              <Text style={styles.itemName}>
                {it.name} <Text style={styles.itemQty}>x{it.quantity}</Text>
              </Text>
              <Text style={styles.itemPrice}>{money(Number(it.price) * Number(it.quantity))}</Text>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.sectionTitle}>{t('total')}</Text>
      <Card style={{ marginBottom: spacing(2) }}>
        <Row label={t('items')} value={money(itemsSubtotal(order))} />
        {!storeAdmin && order.deliveryFee != null && <Row label={t('deliveryFee')} value={money(order.deliveryFee)} />}
        {!storeAdmin && order.serviceFee != null && <Row label={t('serviceFee')} value={money(order.serviceFee)} />}
        <Row label={t('paymentType')} value={formatPaymentType(order.paymentType, t)} />
        <Row label={t('total')} value={money(storeAdmin ? itemsSubtotal(order) : grandTotal(order))} />
      </Card>

      {/* Driver section (admin / superadmin only) */}
      {driversAllowed && (
        <>
          <Text style={styles.sectionTitle}>{t('driver')}</Text>
          <Card style={{ marginBottom: spacing(2) }}>
            <Row label={t('driver')} value={hasDriver ? order.driverName || '—' : t('noDriver')} />
            {isPreparingAndUnassigned(order) && (
              <Button title={t('assignDriver')} onPress={openAssign} style={{ marginTop: spacing(1.5) }} />
            )}
            {canReassignDriver(order) && (
              <Button
                title={t('reassignDriver')}
                variant="secondary"
                onPress={() => setReassignOpen(true)}
                style={{ marginTop: spacing(1.5) }}
              />
            )}
          </Card>
        </>
      )}

      {/* Cliq proof */}
      {order.paymentType === 'Cliq' && order.paymentVerificationImage && (
        <Card style={{ marginBottom: spacing(2) }}>
          <Text style={styles.sectionInline}>{t('cliqProof')}</Text>
          <Button
            title={t('openImage')}
            variant="secondary"
            small
            onPress={() => Linking.openURL(order.paymentVerificationImage)}
            style={{ marginTop: spacing(1) }}
          />
        </Card>
      )}

      {/* Status actions */}
      {(statusOptions.length > 0 || showReject) && (
        <View style={{ gap: spacing(1.5), marginTop: spacing(0.5) }}>
          {statusOptions.length > 0 && <Text style={styles.sectionTitle}>{t('updateStatus')}</Text>}
          {statusOptions.map((s) => (
            <Button key={s} title={`${t('advanceTo')}: ${s}`} variant="success" loading={working} onPress={() => changeStatus(s)} />
          ))}
          {showReject && (
            <Button title={t('rejectOrder')} variant="danger" disabled={working} onPress={confirmReject} />
          )}
          {storeAdmin && <Text style={styles.hint}>{t('storeAdminStatusHint')}</Text>}
        </View>
      )}

      {/* Assign driver modal */}
      <Modal visible={assignOpen} transparent animationType="slide" onRequestClose={() => setAssignOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAssignOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{t('assignDriver')}</Text>
            {nearby.length === 0 ? (
              <Text style={styles.muted}>{t('noDriversAvailable')}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 220 }}>
                {nearby.map((d) => (
                  <View key={d.id} style={styles.driverRow}>
                    <Text style={styles.driverName}>{d.name}</Text>
                    <Text style={styles.driverMeta}>
                      {d.mobile}{d.distanceKm != null ? ` · ${Number(d.distanceKm).toFixed(1)} km` : ''}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <Button title={t('offerNearestDriver')} loading={working} onPress={offerNearest} style={{ marginTop: spacing(2) }} />
            {nearby.length > 0 && (
              <Button title={t('autoAssign')} variant="secondary" disabled={working} onPress={autoAssign} style={{ marginTop: spacing(1) }} />
            )}
            <Button title={t('cancel')} variant="secondary" onPress={() => setAssignOpen(false)} style={{ marginTop: spacing(1) }} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reassign driver modal */}
      <Modal visible={reassignOpen} transparent animationType="slide" onRequestClose={() => setReassignOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setReassignOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{t('reassignDriver')}</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {drivers.filter((d) => !d.isBlocked).map((d) => {
                const current = String(d.id) === String(order.driverId ?? '');
                return (
                  <Pressable
                    key={d.id}
                    style={[styles.driverPick, current && styles.driverPickCurrent]}
                    disabled={working || current}
                    onPress={() => reassignTo(d.id)}
                  >
                    <Text style={styles.driverName}>{d.name}{current ? ' ✓' : ''}</Text>
                    <Text style={styles.driverMeta}>{d.mobile}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button title={t('cancel')} variant="secondary" onPress={() => setReassignOpen(false)} style={{ marginTop: spacing(1.5) }} />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontSize: 22, fontWeight: '800', color: colors.ink },
  time: { fontSize: 13, color: colors.muted, marginTop: spacing(0.5) },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.subtext, marginBottom: spacing(1), marginLeft: spacing(0.5), textTransform: 'uppercase' },
  sectionInline: { fontSize: 15, fontWeight: '700', color: colors.text },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing(0.9) },
  itemDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  itemName: { fontSize: 15, color: colors.text, flexShrink: 1, paddingRight: spacing(1) },
  itemQty: { color: colors.subtext, fontWeight: '700' },
  itemPrice: { fontSize: 15, color: colors.text, fontWeight: '600' },
  muted: { color: colors.subtext, fontSize: 14 },
  hint: { fontSize: 12, color: colors.muted, marginTop: spacing(0.5) },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(2.5),
    paddingBottom: spacing(4),
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, marginBottom: spacing(2) },
  driverRow: { paddingVertical: spacing(1), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  driverPick: {
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(1.5),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing(1),
  },
  driverPickCurrent: { backgroundColor: colors.successBg, borderColor: colors.success },
  driverName: { fontSize: 15, fontWeight: '600', color: colors.text },
  driverMeta: { fontSize: 13, color: colors.subtext, marginTop: 2 },
});
