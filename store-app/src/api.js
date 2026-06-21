import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './config';

export const TOKEN_KEY = 'storeApp.adminToken';

let inMemoryToken = null;

export async function getToken() {
  if (inMemoryToken) return inMemoryToken;
  inMemoryToken = await AsyncStorage.getItem(TOKEN_KEY);
  return inMemoryToken;
}

export async function setToken(token) {
  inMemoryToken = token || null;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: token } : {}),
    ...(options.headers || {}),
  };
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------------- Auth ---------------- */
export function login(email, password) {
  return request('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function getMe() {
  return request('/api/admin/me');
}

export function changeMyPassword(body) {
  return request('/api/admin/me/password', { method: 'PATCH', body: JSON.stringify(body) });
}

/* ---------------- Stores ---------------- */
export function getStores(params = {}) {
  const s = new URLSearchParams();
  if (params.withStats) s.set('withStats', '1');
  const qs = s.toString();
  return request('/api/admin/stores' + (qs ? '?' + qs : ''));
}

export function getStore(id) {
  return request(`/api/admin/stores/${id}`);
}

export function updateStore(id, body) {
  return request(`/api/admin/stores/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/* ---------------- Products ---------------- */
export function getStoreProducts(storeId) {
  return request(`/api/admin/stores/${storeId}/products`);
}

export function createProduct(storeId, body) {
  return request(`/api/admin/stores/${storeId}/products`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateProduct(storeId, productId, body) {
  return request(`/api/admin/stores/${storeId}/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteProduct(storeId, productId) {
  return request(`/api/admin/stores/${storeId}/products/${productId}`, { method: 'DELETE' });
}

/* ---------------- Orders ---------------- */
export function getOrders(params = {}) {
  const s = new URLSearchParams();
  if (params.allDates) s.set('allDates', 'true');
  if (params.dateFrom) s.set('dateFrom', params.dateFrom);
  if (params.dateTo) s.set('dateTo', params.dateTo);
  if (params.status) s.set('status', params.status);
  if (params.statusFilter) s.set('statusFilter', params.statusFilter);
  if (params.orderType) s.set('orderType', params.orderType);
  if (params.storeId) s.set('storeId', params.storeId);
  if (params.name) s.set('name', params.name);
  if (params.orderId != null && String(params.orderId).trim() !== '') {
    s.set('orderId', String(params.orderId).trim());
  }
  const qs = s.toString();
  return request('/api/admin/orders' + (qs ? '?' + qs : ''));
}

export function getOrdersCounts(params = {}) {
  const s = new URLSearchParams();
  if (params.allDates) s.set('allDates', 'true');
  if (params.dateFrom) s.set('dateFrom', params.dateFrom);
  if (params.dateTo) s.set('dateTo', params.dateTo);
  const qs = s.toString();
  return request('/api/admin/orders/counts' + (qs ? '?' + qs : ''));
}

export function getOrder(orderId, type) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return request(`/api/admin/orders/${orderId}${qs}`);
}

export function updateOrderStatus(orderId, status) {
  return request(`/api/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function rejectOrder(orderId) {
  return request(`/api/admin/orders/${orderId}/reject`, { method: 'POST' });
}

/* ---------------- Drivers (admin / superadmin only) ---------------- */
export function getDrivers() {
  return request('/api/admin/drivers');
}

export function getOrderAvailableDrivers(orderId) {
  return request(`/api/admin/orders/${orderId}/available-drivers`);
}

export function getOrderNearbyDrivers(orderId) {
  return request(`/api/admin/orders/${orderId}/nearby-drivers`);
}

export function requestDriver(orderId) {
  return request(`/api/admin/orders/${orderId}/request-driver`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function autoAssignDriver(orderId) {
  return request(`/api/admin/orders/${orderId}/auto-assign`, { method: 'POST' });
}

export function reassignOrderDriver(orderId, driverId) {
  return request(`/api/admin/orders/${orderId}/reassign-driver`, {
    method: 'POST',
    body: JSON.stringify({ driverId }),
  });
}

/* ---------------- Arheb Box ---------------- */
export function getArhebBoxRequests() {
  return request('/api/admin/arheb-box');
}

/* ---------------- Activity log ---------------- */
export function getActivityLog(params = {}) {
  const s = new URLSearchParams();
  if (params.page) s.set('page', String(params.page));
  if (params.perPage) s.set('perPage', String(params.perPage));
  const qs = s.toString();
  return request('/api/admin/activity-log' + (qs ? '?' + qs : ''));
}

/* ---------------- Categories / food types (public) ---------------- */
export function getCategories() {
  return request('/api/categories');
}

/* ---------------- Store FCM (push) ---------------- */
export function registerStoreFcm(storeId, fcmToken) {
  return request('/api/store/update-fcm', {
    method: 'POST',
    body: JSON.stringify({ storeId, fcmToken }),
  });
}
