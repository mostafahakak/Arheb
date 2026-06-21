import Constants from 'expo-constants';

/** Backend API base. Override via app.json > expo.extra.apiBase. */
export const API_BASE =
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.apiBase) ||
  'https://arheb-backend.onrender.com';

/** Firebase web config (used only for Storage image uploads, same project as dashboard). */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCWd6iEjRobJzPKZOhDTJYFhwM6jOxzxqQ',
  authDomain: 'arheb-40c1e.firebaseapp.com',
  projectId: 'arheb-40c1e',
  storageBucket: 'arheb-40c1e.firebasestorage.app',
  messagingSenderId: '914622884520',
  appId: '1:914622884520:web:e6613991c39bad2faff09d',
};
