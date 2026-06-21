import { initializeApp, getApps, getApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { FIREBASE_CONFIG } from '../config';

function app() {
  return getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
}

function sanitize(part, fallback = 'item') {
  if (!part || typeof part !== 'string') return fallback;
  return (
    String(part)
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .slice(0, 100) || fallback
  );
}

/**
 * Upload a local image (file:// uri from expo-image-picker) to Firebase Storage
 * under Products/<storeName>/<productName>.<ext> and return the download URL.
 */
export async function uploadProductImage(localUri, storeName, productName) {
  const storage = getStorage(app());
  const res = await fetch(localUri);
  const blob = await res.blob();
  const extMatch = /\.(\w+)(\?|$)/.exec(localUri || '');
  const ext = (extMatch && extMatch[1]) || 'jpg';
  const path = `Products/${sanitize(storeName, 'Store')}/${sanitize(productName, 'product')}_${Date.now()}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}
