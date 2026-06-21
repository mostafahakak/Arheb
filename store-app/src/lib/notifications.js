import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerStoreFcm } from '../api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Request permission, get the device push token, and register it to the store so the
 * backend (Firebase Admin) can push `store_new_order` notifications.
 *
 * Note: a native FCM/APNs device token requires a custom dev build (not Expo Go).
 * In Expo Go this resolves to null and registration is skipped gracefully.
 */
export async function registerForStoreNotifications(storeId) {
  if (!storeId) return { ok: false, reason: 'no-store' };
  try {
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return { ok: false, reason: 'denied' };

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Orders',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let token = null;
    try {
      const devToken = await Notifications.getDevicePushTokenAsync();
      token = devToken?.data || null;
    } catch (e) {
      token = null;
    }
    if (!token) return { ok: false, reason: 'no-token' };

    await registerStoreFcm(storeId, token);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export function addNotificationListener(handler) {
  const sub = Notifications.addNotificationReceivedListener(handler);
  return () => sub.remove();
}
