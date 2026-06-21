# Arheb Store (mobile app)

A native **React Native (Expo)** app for **store admins** only. It reuses the existing Arheb
backend (`/api/admin/*`) — the same APIs the web dashboard uses — but is scoped to a single
store via the `store_admin` role.

## Features

- **Login** with store-admin email/password (token persisted with AsyncStorage).
- **Orders** — list the store's orders (today / all, filter by status), open an order, and
  advance status (`Waiting confirmation → Preparing → On the way`) or **reject** while the
  order is still awaiting confirmation/payment.
- **My Store** — open/pause the store, toggle payment methods (Cash / Card / Cliq), edit
  opening & closing time.
- **Products** — list products, toggle availability, add/edit a product with image upload
  (Firebase Storage), long-press to delete.
- **Arheb Box** — view box delivery requests.
- **Activity** — the admin's own activity log.
- **Account** — change password, switch language (English / العربية), logout.
- **Push notifications** — registers the device token to the store so the backend can send
  `store_new_order` pushes.

## Requirements

- Node.js 18+
- The [Expo](https://docs.expo.dev/) toolchain (no global install needed; `npx expo` works)
- The **Expo Go** app on your phone for quick testing, OR a custom **dev build** for push
  notifications (see note below)

## Setup

```bash
cd store-app
npm install
npm start
```

Then scan the QR code with **Expo Go** (Android) or the Camera app (iOS), or press `a` / `i`
to launch an emulator/simulator.

## Configuration

The backend URL is read from `app.json` → `expo.extra.apiBase` (defaults to the production
Render backend `https://arheb-backend.onrender.com`). To point at a local backend, change that
value (use your machine's LAN IP, not `localhost`, so the phone can reach it):

```json
"extra": { "apiBase": "http://192.168.1.50:4000" }
```

## Push notifications

The backend sends order pushes through **Firebase Cloud Messaging** (`POST /api/store/update-fcm`
stores the token). To receive a real FCM/APNs device token the app must run as a **custom dev
build / standalone build**, not inside Expo Go:

```bash
npx expo install expo-dev-client
npx eas build --profile development --platform android
```

In Expo Go, token registration is skipped gracefully (everything else works).

## Image uploads

Product images are uploaded to the same Firebase Storage bucket as the web dashboard
(`arheb-40c1e.firebasestorage.app`) under `Products/<storeName>/`. Config lives in
`src/config.js`.

## Project structure

```
store-app/
  App.js                     # providers + navigator
  src/
    api.js                   # backend client (admin endpoints scoped to the store)
    config.js                # API base + Firebase config
    theme.js                 # colors, spacing, status colors
    i18n.js                  # EN/AR strings + LocaleProvider
    context/
      AuthContext.js         # login, token, current admin, storeId
      StoreContext.js        # resolves the active store
    lib/
      orders.js              # status transitions + formatting helpers
      firebaseUpload.js      # product image upload
      notifications.js       # push token registration
    components/ui.js         # Button, Card, Field, Badge, Row, states
    navigation/RootNavigator.js
    screens/
      LoginScreen.js
      OrdersScreen.js / OrderDetailScreen.js
      MyStoreScreen.js
      ProductsScreen.js / ProductFormScreen.js
      ArhebBoxScreen.js
      ActivityLogScreen.js
      AccountScreen.js
```

## Notes for the frontend/backend team

- The app only uses **existing** backend endpoints; no backend changes are required.
- Store-admin order/cancel rules are enforced by the backend; the app mirrors them in
  `src/lib/orders.js` for UX only.
- Login uses `POST /api/admin/login`; a `store_admin` account is scoped to its `storeId`.
