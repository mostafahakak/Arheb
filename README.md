# Arheb Backend API Documentation

<div align="center">

**Complete REST API Documentation for Arheb E-commerce Backend**

[![API Version](https://img.shields.io/badge/API-v1.0-blue.svg)](https://arheb-backend.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Base URL:** `https://arheb-backend.onrender.com`

</div>

---

## Backend setup (local)

- **Requirements**: Node.js 20.x, npm, SQLite (bundled with `better-sqlite3`), Firebase project (for OTP + FCM).
- **Install**:
  - `npm install`
- **Environment**: create `.env` in the project root (same level as `src/`), for example:

```env
PORT=4000
NODE_ENV=development
ARHEB_JSON_DIR=./Arheb API JSON

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...

JWT_SECRET=change-me
SUPERADMIN_EMAIL=admin@arheb.app
SUPERADMIN_PASSWORD=strong-password-here

# Madfoat / PayTabs payment gateway
PAYTABS_SERVER_KEY=S9JNLKHZRK-JMRR6BJ2RN-DZ69WH62JK
PAYTABS_CLIENT_KEY=CBKMDV-VR626N-RRG26M-HBNT7P
PAYTABS_CURRENCY=JOD
BASE_URL=https://arheb-backend.onrender.com

# JOFOTARA e-invoicing (Jordan tax)
JOFOTARA_CLIENT_ID=your-client-id
JOFOTARA_SECRET_KEY=your-secret-key
JOFOTARA_INCOME_SOURCE=your-income-source-sequence
JOFOTARA_SELLER_TIN=your-tax-id-number
JOFOTARA_SELLER_NAME=your-company-name
# Pause JoFotara submissions (same effect as dashboard “Pause e-invoice”). Values: 1 | true | yes (case-insensitive).
# JOFOTARA_PAUSED=true
# Alias for the same pause flag (optional):
# EINVOICE_PAUSED=true

# Pause new Arheb Box orders (quote, POST /api/arheb-box, card initiate). Values: true | 1 | yes (case-insensitive). Omit or set false to allow orders.
# ARHEB_BOX_PAUSED=true

# WhatsApp OTP login (customer + driver): prefer Twilio when all Twilio vars are set; else Meta Cloud API.
# Preferred: Twilio Verify WhatsApp — create a Verify service in Console; enable WhatsApp on the service.
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxx
# Optional: TWILIO_VERIFY_PENDING_TTL_MS=600000 (stored pending row TTL, default 10 min)
#
# Or Twilio Programmable Messaging (Content template + sender):
# TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
# TWILIO_WHATSAPP_OTP_CONTENT_SID=HXxxxxxxxx
# Optional: TWILIO_WHATSAPP_OTP_CODE_VAR=1; TWILIO_WHATSAPP_OTP_CONTENT_VARIABLES_EXTRAS_JSON={"2":"Arheb"}
#
# Or Meta (if Twilio Verify + Twilio Messaging both incomplete):
# WHATSAPP_ACCESS_TOKEN=
# WHATSAPP_PHONE_NUMBER_ID=
# WHATSAPP_OTP_TEMPLATE_NAME=arheb_login_otp_ar
# WHATSAPP_OTP_LANG=ar

# Show Arheb Box as “coming soon” in GET /api/contact → data.arhebBox.comingSoon (OR with DB flag from PATCH /api/admin/info). Not hardcoded in app code.
# ARHEB_BOX_COMING_SOON=true
```

- **Run locally**:
  - Development: `npm run dev`
  - Production build: `npm run build && npm start`

The API will be available on `http://localhost:4000` (or the port you configure).

---

## GitHub & deployment workflow

This project is already a Node.js backend that can be pushed to GitHub and deployed on any Node host (Render, Railway, VPS, etc.).

1. **Initialize / check git**
   - Inside the project folder:
     - `git status` (ensure there are no untracked secrets like `.env`).
2. **Ignore local-only files**
   - `.env` is already listed in `.gitignore` (do not commit it).
3. **Commit backend changes**
   - Example:

```bash
git add .
git commit -m "Document backend setup and deployment"
```

4. **Create GitHub repo and push**
   - On GitHub, create a new empty repository (without README).
   - Then run:

```bash
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

5. **Deploy from GitHub (example: Render)**
   - On Render (or your host), create a **Web Service** from the GitHub repo.
   - Set the **build command** to `npm install` (or `npm ci`) and the **start command** to `npm start`.
   - Configure environment variables in the provider dashboard (same values as your local `.env` but **never commit `.env`**).
   - If using a persistent disk for JSON data, set `ARHEB_JSON_DIR` to the mount path (see the deployment notes below).

---

## Admin Dashboard

A separate **Admin Dashboard** (React + Next.js) is in the `dashboard/` folder. It supports:

- **Login** with email and password (separate from customer phone OTP).
- **Roles**: Super Admin, Admin, Store Admin.
  - **Super Admin**: Full access; manage all stores, orders, categories, admins (including other SuperAdmins), and **Arheb Box** requests.
  - **Admin**: Same as Super Admin but **cannot** add or remove SuperAdmins.
  - **Store Admin**: Sees only their assigned store; can edit store details, add/edit/delete products, and view orders for that store.
- **Arheb Box**: Admins can list requests, open **detail** (**GET /api/admin/arheb-box/:id**), update status, **assign** (**POST /api/admin/arheb-box/:id/assign-driver**) or **reassign** (**POST /api/admin/arheb-box/:id/reassign-driver**, Admin/SuperAdmin — same idea as **POST /api/admin/orders/:orderId/reassign-driver**), and track pricing fields. **SuperAdmin** can **permanently delete** a request (**DELETE /api/admin/arheb-box/:id**), same idea as deleting a store order. Requests are submitted by users with Bearer token and stored in the database.
- **English and Arabic** (language switcher in the UI).
- **HTTP API:** all data operations use this backend’s **`/api/admin/*`** routes (see [Admin Dashboard HTTP usage](#admin-dashboard-http-usage)); the dashboard also uploads images to **Firebase Storage** in the browser, then persists returned URLs via **`PATCH`** endpoints.
- **Driver earnings:** Each driver can have a **per-driver commission percent** (`commissionPercent` on the driver row). If unset, the effective rate comes from **App info** — **`driverDeliveryPercent`** on **GET/PATCH /api/admin/info** (same screen as email/phone/Cliq). If that is also unset, the legacy **global driver commission** setting (**GET/PATCH /api/admin/settings/driver-commission**) is used. The **Drivers** list links to a **driver profile** page (`/dashboard/drivers/profile/?id=`) with filters (status, date range), delivered-order profit totals, and full customer **driver ratings** (stars + notes). Drivers only see their **average rating** in the driver app, not individual reviews.

To create the **initial SuperAdmin** on first run, set in the backend `.env`:

- `SUPERADMIN_EMAIL` – email for the first SuperAdmin.
- `SUPERADMIN_PASSWORD` – password for the first SuperAdmin.

If no SuperAdmin exists, one is created at startup. Run the dashboard with `cd dashboard && npm install && npm run dev` (see `dashboard/README.md`).

---

## Deployment (e.g. Render) – no reset on redeploy

To avoid losing categories, stores, and products on every redeploy, use a **persistent directory** for the JSON data files.

1. **Create a persistent disk** (e.g. on Render: Dashboard → your service → Disks → Add Disk, mount path e.g. `/data/arheb`).
2. **Set the env var** in your service:
   - `ARHEB_JSON_DIR=/data/arheb`
   - `ARHEB_DATA_DIR=/data/arheb` (for SQLite `auth.db`)
   (Use the same path as the disk mount path.)
3. **Redeploy.** On first run the app copies the repo’s initial JSON files into that directory if they’re missing. After that, all reads and writes use that directory, so **redeploys no longer overwrite your data**.

If `ARHEB_JSON_DIR` is not set, the app uses the repo folder `Arheb API JSON` (current behaviour); data there is replaced on each deploy.

---

## Push notifications (FCM) and driver presence

- **Firebase Cloud Messaging (FCM)** is used to send push notifications to drivers (e.g. new order assigned) and to app users (order status updates, broadcast messages). Set **`FIREBASE_SERVICE_ACCOUNT_JSON`** in `.env` to a **stringified JSON** of your Firebase service account key (Project settings → Service accounts → Generate new private key). If unset, the backend uses `GOOGLE_APPLICATION_CREDENTIALS` (path to key file). Without valid credentials, FCM send is skipped (no crash).
- **Driver auto-assignment (Preparing):** When an order moves to **Preparing** (e.g. **PATCH** `/api/admin/orders/:orderId/status`), the backend runs **automatic assignment** for that store: unassigned **Preparing** orders are sorted by `id`, grouped into **clusters** where consecutive deliveries are within **1 km** (haversine on `addressLat` / `addressLong`). Each cluster is assigned to an **online** driver (Socket.IO `/driver-presence` + location); the server prefers **joining** an existing driver when every delivery in the cluster is within **1 km** of at least one of that driver’s **already-assigned** Preparing orders for the same store. There is **no cap** on how many active orders a driver may carry. Assignment sets **`driverId`** / **`driverName`** and order status to **`Driver to pick`** (driver then uses **on-the-way** and **complete** as in [Driver workflow](#driver-workflow-store--arheb-box)). Drivers **cannot reject** auto-assigned store orders (**POST** `/api/driver/orders/:orderId/reject-request` returns **403**). Optional columns **`driverAssignmentStatus`** (`searching` \| `no_driver_online` \| cleared) and **`driverSearchStartedAt`** support dashboard “searching” UI. **Admin / SuperAdmin** can still use **POST** `/api/admin/orders/:orderId/request-driver` (manual invite + accept flow). **GET** `/api/admin/orders/:orderId/driver-map` returns store, delivery, live driver location, tracking, and **`mapPreviewUrl`** (Google Maps dir link) for a **Track** button.
- **User FCM**: Users can set `fcmToken` via **PUT /api/profile** or send it with **POST /api/checkout**. Order status changes (and broadcast notifications) are sent to the user’s token. **GET /api/profile/notifications** lists notification history for that user only (Bearer user JWT).
- **Store FCM**: Store devices (kitchen / POS) register a token with **POST /api/store/update-fcm** (`storeId`, `fcmToken`). Tokens are stored in the database and returned on **GET / PATCH** admin store details as `fcmToken`. When a customer order is created (**POST /api/checkout** or payment flow that creates an order), the backend sends a push to that store’s token if configured (`type: store_new_order` in the data payload).
- **Broadcast**: Admin/SuperAdmin can send a notification to all registered users via **POST /api/admin/notifications/broadcast** (`title`, `body`, optional `imageUrl`).
- **FCM test (one device)**: **SuperAdmin** can send a single test push via **POST /api/admin/notifications/fcm-test** (`fcmToken`, `title`, `body`, optional `imageUrl`). Use the same Firebase project as **`FIREBASE_SERVICE_ACCOUNT_JSON`**. The hosted admin dashboard includes a **Notifications** sidebar item (SuperAdmin only) with a form for token test and broadcast.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
  - [Register / Send OTP](#register--send-otp)
  - [Verify OTP](#verify-otp)
  - [WhatsApp OTP login (customer)](#whatsapp-otp-login-customer)
  - [Delete User](#delete-user)
- [Products](#products)
  - [Get Products (Paginated)](#get-products-paginated)
  - [Get Product by ID](#get-product-by-id)
- [Stores](#stores)
  - [Get All Stores](#get-all-stores)
  - [Get Top Rated Stores](#get-top-rated-stores)
  - [Get Premium Stores](#get-premium-stores)
  - [Get Exclusive Stores](#get-exclusive-stores)
  - [Get Stores by Category](#get-stores-by-category)
  - [Get Store Payment Methods](#get-store-payment-methods)
  - [Update Store FCM Token](#update-store-fcm-token)
  - [Get Store Products](#get-store-products)
  - [Get Store Products (paginated)](#get-store-products-paginated)
  - [Get Store Products (paginated by store categories)](#get-store-products-paginated-by-store-categories)
  - [Store category tab images](#store-category-tab-images)
  - [Get Store Products by Category](#get-store-products-by-category)
- [Categories](#categories)
  - [Get All Categories](#get-all-categories)
  - [Get Products by Category](#get-products-by-category)
- [Search](#search)
  - [Search Stores & Products](#search-stores--products)
- [Home](#home)
- [Profile](#profile)
  - [Get Profile](#get-profile)
  - [Update Profile (Name Only)](#update-profile-name-only)
  - [Add Address](#add-address)
  - [Update Address](#update-address)
  - [Delete Address](#delete-address)
- [Checkout & Orders](#checkout--orders)
  - [Quote Checkout Fees](#quote-checkout-fees)
  - [Create Order](#create-order)
  - [Get All Orders](#get-all-orders)
  - [Get Order by ID](#get-order-by-id)
  - [Rate Order](#rate-order)
  - [Rate Driver (Customer)](#rate-driver-customer)
- [Payment (Card / Online)](#payment-card--online)
  - [Get Client Key](#get-client-key)
  - [Initiate Payment](#initiate-payment)
  - [Payment Callback (server-to-server)](#payment-callback)
  - [Payment Return (browser redirect)](#payment-return)
  - [Query Transaction](#query-transaction)
  - [Refund Transaction](#refund-transaction)
  - [List Payment Transactions](#list-payment-transactions)
- [Order Tracking (WebSocket)](#order-tracking-websocket)
  - [Connection](#connection)
  - [Driver Events](#driver-events)
  - [Customer Events](#customer-events)
  - [Get Tracking Status](#get-tracking-status)
- [Promo Codes](#promo-codes)
  - [Validate Promo Code](#validate-promo-code)
  - [Admin promo codes](#admin-promo-codes)
- [Popup](#popup)
  - [Get Popup](#get-popup)
- [Arheb Box](#arheb-box)
  - [Submit Arheb Box Request](#submit-arheb-box-request)
- [Contact](#contact)
  - [Get Contact Information](#get-contact-information)
  - [App version (public)](#app-version-public)
  - [Update Contact Information (Admin)](#update-contact-information-admin)
- [Admin API](#admin-api)
  - [Admin Dashboard HTTP usage](#admin-dashboard-http-usage)
  - [GET /api/admin/users (order statistics)](#get-apiproadminusers-order-statistics)
  - [Admin API complete endpoint catalog](#admin-api-complete-endpoint-catalog)
  - [Admin Login](#admin-login)
  - [Get Current Admin (Me)](#get-current-admin-me)
  - [Admins CRUD](#admins-crud)
  - [Admin Stores](#admin-stores)
  - [Admin Products](#admin-products)
  - [Admin Pending Products (Approval Queue)](#admin-pending-products-approval-queue)
  - [Admin Orders](#admin-orders)
  - [Admin Dashboard Sales](#admin-dashboard-sales)
  - [Admin Arheb Box](#admin-arheb-box)
  - [Admin Categories](#admin-categories)
  - [Admin Drivers](#admin-drivers)
  - [Admin Driver Commission](#admin-driver-commission)
  - [Admin App Info (driver delivery default)](#admin-app-info-driver-delivery-default)
  - [Admin platform checkout fees](#admin-platform-checkout-fees)
  - [Admin Home Banners & Offers](#admin-home-banners--offers)
  - [Admin Driver Profile (detail)](#admin-driver-profile-detail)
- [Driver API](#driver-api)
  - [Driver workflow (store & Arheb Box)](#driver-workflow-store--arheb-box)
  - [Driver Send OTP](#driver-send-otp)
  - [Driver WhatsApp OTP](#driver-whatsapp-otp)
  - [Driver Login](#driver-login)
  - [Driver Home](#driver-home)
  - [Driver Stats](#driver-stats)
  - [Driver Orders List](#driver-orders-list)
  - [Driver Order Detail](#driver-order-detail)
  - [Driver Accept Order](#driver-accept-order)
  - [Driver Mark Order On the Way](#driver-mark-order-on-the-way)
  - [Driver Complete Order](#driver-complete-order)
  - [Driver Mark Arheb Box On the Way](#driver-mark-arheb-box-on-the-way)
  - [Driver Complete Arheb Box](#driver-complete-arheb-box-delivery)
  - [Driver Assigned Orders](#driver-assigned-orders)
  - [Driver Earnings (Today & Summary)](#driver-earnings-today--summary)
  - [Driver order object (fields)](#driver-order-object-fields)
- [Error Handling](#error-handling)
- [Testing](#testing)

---

## Overview

Arheb Backend is a comprehensive REST API for an e-commerce platform built with Node.js, Express, Firebase Authentication, and SQLite. It provides:

- 🔐 Firebase Phone OTP Authentication
- 📦 Product & Store Management
- 🛒 Order Processing & Checkout
- 💰 Promo Code System
- ⭐ Rating System
- 👤 User Profile Management
- 📞 Contact Management
- 🚚 Real-time Order Tracking (WebSocket)
- 🚗 Driver API (login, home, accept → **Driver to pick**, on-the-way, delivered; Arheb Box same idea)

### Key Features

- **Authentication**: Firebase phone OTP verification with JWT tokens
- **Pagination**: Efficient product listing with pagination
- **Store Ratings**: Dynamic rating system that updates store averages
- **Order Management**: Complete order lifecycle management
- **Admin Controls**: Admin-only endpoints for contact management
- **Promo Codes**: Promo code validation and automatic discount application
- **Real-time Tracking**: WebSocket-based order tracking with driver location updates every 3 seconds
- **Driver App**: Drivers can register/login with OTP, view home (stats, **available** vs **Driver to pick** vs **on-the-way** orders; Arheb **arhebBoxAvailable** vs **arhebBoxMyActive**), list orders, **on-the-way** then **delivered** (store and Arheb Box)

---

## Authentication

All authentication endpoints use Firebase Phone Authentication with OTP verification.

### Register / Send OTP

Sends an OTP code to the provided phone number.

**Endpoint:** `POST /api/auth/register`

**Authentication:** Not required

**Request Body:**
```json
{
  "phoneNumber": "+201500157920",
  "recaptchaToken": "optional-recaptcha-token"
}
```

**Success Response (200):**
```json
{
  "message": "OTP SENT SUCCESSFUL",
  "case": 1,
  "alreadyRegistered": false,
  "sessionInfo": "AD8T5IuI4-lkeehNBSwKvmV8Hn98DpMamNshf5jcZL103db6jhtb765Lq5QM..."
}
```

**Error Response (500):**
```json
{
  "message": "Error message from Firebase",
  "case": 2
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phoneNumber: '+201500157920',
    recaptchaToken: 'your-recaptcha-token' // optional
  })
});

const data = await response.json();
console.log(data.sessionInfo); // Save for verify-otp
```

---

### Verify OTP

Verifies the OTP code and returns authentication tokens.

**Endpoint:** `POST /api/auth/verify-otp`

**Authentication:** Not required

**Request Body:**
```json
{
  "phoneNumber": "+201500157920",
  "sessionInfo": "session-info-from-register-response",
  "otp": "111111"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "token": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "firebaseToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjA4MmU5NzVlMDdkZmE0OTYwYzdiN2I0ZmMxZDEwZjkxNmRjMmY1NWIiLCJ0eXAiOiJKV1QifQ...",
  "phoneNumber": "+201500157920"
}
```

**Error Response (401):**
```json
{
  "success": false,
  "message": "Invalid OTP or error message"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/auth/verify-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phoneNumber: '+201500157920',
    sessionInfo: 'session-info-from-register',
    otp: '111111'
  })
});

const data = await response.json();
if (data.success) {
  const authToken = data.token; // Bearer token for authenticated requests
  const firebaseToken = data.firebaseToken; // Firebase ID token
}
```

---

### WhatsApp OTP login (customer)

Alternative to Firebase phone OTP: sends a **6-digit code** via WhatsApp. Codes are short-lived (about **2 minutes**); resend cooldown applies.

**Configure (Twilio Verify WhatsApp — preferred if set):** **`TWILIO_ACCOUNT_SID`**, **`TWILIO_AUTH_TOKEN`**, **`TWILIO_VERIFY_SERVICE_SID`** (`VA…` from [Verify Services](https://console.twilio.com/us1/verify/services)). In the Twilio Console, create a Verify service and add **WhatsApp** as a channel; Twilio sends branded OTPs (no separate Content template or `TWILIO_WHATSAPP_FROM` required for this path). See [Verify WhatsApp](https://www.twilio.com/docs/verify/whatsapp).

**Or (Twilio Messaging + Content template):** **`TWILIO_WHATSAPP_FROM`**, **`TWILIO_WHATSAPP_OTP_CONTENT_SID`**, plus Account SID and Auth Token — [WhatsApp quickstart](https://www.twilio.com/docs/whatsapp/quickstart).

**Or (Meta Cloud API):** **`WHATSAPP_ACCESS_TOKEN`**, **`WHATSAPP_PHONE_NUMBER_ID`**, and optional template/language vars. If no provider is fully configured, endpoints return **503**.

**Send code —** `POST /api/auth/whatsapp/send-code`

**Body:** `{ "phoneNumber": "+9627XXXXXXXX" }` (Jordan numbers normalized server-side)

**Success (200):** `{ "success": true, "verificationId": "...", "expiresIn": 120, "alreadyRegistered": boolean, "channel": "whatsapp", ... }`

**Verify —** `POST /api/auth/whatsapp/verify-code`

**Body:** `{ "phoneNumber": "...", "verificationId": "...", "otp": "123456" }`

**Success (200):** Same session shape as **Verify OTP** (`token`, `firebaseToken` when applicable, `phoneNumber`).

---

### Delete User

Deletes a user account from both Firebase Auth and the local database.

**Endpoint:** `DELETE /api/auth/user`

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "firebaseIdToken": "firebase-token-from-verify-otp-response"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "User deleted"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/auth/user', {
  method: 'DELETE',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-jwt-token-here'
  },
  body: JSON.stringify({
    firebaseIdToken: 'your-firebase-token-here'
  })
});
```

---

## Products

### Get Products (Paginated)

Retrieves products with pagination support (20 products per page). Each product includes **`discount`** (number or string, e.g. `10` or `"10%"`, or `null` when no discount) and **`originalPrice`** (price before discount; falls back to `price` when not set) so the client can render offers correctly.

**Endpoint:** `GET /api/products?page=1`

**Authentication:** Not required

**Query Parameters:**
- `page` (optional) - Page number (default: 1)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Products retrieved successfully",
  "data": {
    "products": [
      {
        "id": "1",
        "name": "وجبة فردية",
        "nameAr": "وجبة فردية",
        "nameEn": "Single Meal",
        "image": "https://example.com/products/meal1.jpg",
        "price": 4.5,
        "originalPrice": 5.0,
        "discount": "10",
        "store": {
          "id": "1",
          "name": "كريسبي تشيكن"
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "itemsPerPage": 20,
      "totalProducts": 50,
      "totalPages": 3,
      "hasMore": true
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Last Page Response:**
```json
{
  "success": true,
  "message": "Products retrieved successfully - No more products available",
  "data": {
    "products": [...],
    "pagination": {
      "currentPage": 3,
      "hasMore": false
    }
  }
}
```

**Example:**
```javascript
// Get first page
const response = await fetch('https://arheb-backend.onrender.com/api/products?page=1');
const data = await response.json();

// Get next page
const page2 = await fetch('https://arheb-backend.onrender.com/api/products?page=2');
```

---

### Get Product by ID

Retrieves detailed information about a specific product.

**Endpoint:** `GET /api/products/:id`

**Authentication:** Not required

**Path Parameters:**
- `id` - Product ID

**Success Response (200):**
```json
{
  "success": true,
  "message": "Product details retrieved successfully",
  "data": {
    "product": {
      "id": "1",
      "name": "وجبة فردية",
      "price": 4.5,
      "originalPrice": 5.0,
      "discount": "10",
      "store": {
        "id": "1",
        "name": "كريسبي تشيكن"
      }
    },
    "relatedProducts": [
      { "id": "2", "name": "وجبة مزدوجة", "price": 8, "store": { "id": "1", "name": "كريسبي تشيكن" } }
    ]
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```
- `relatedProducts`: array of up to 8 products from the same store, ordered by name similarity (excludes the current product). Omitted if none.

**Not Found Response (404):**
```json
{
  "success": false,
  "message": "Product not found"
}
```

---

### Get Offers (Discounted Products)

Retrieves all products that currently have a discount applied. This is useful for rendering an **Offers** section in the client app.

**Endpoint:** `GET /api/offers`

**Authentication:** Not required

**Success Response (200):**
```json
{
  "success": true,
  "message": "Offers (discounted products) retrieved successfully",
  "data": {
    "offers": [
      {
        "id": "1",
        "name": "وجبة فردية",
        "price": 4.5,
        "originalPrice": 5.0,
        "discount": "10",
        "image": "https://example.com/products/meal1.jpg",
        "store": {
          "id": "1",
          "name": "كريسبي تشيكن"
        }
      }
    ],
    "count": 1
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Note:**
- Only products with a non-empty `discount` (number > 0 or string like `"10%"`) are returned.
- Each product in `offers` has `price`, `originalPrice`, and `discount` so the client can compute and display the offer.

---

## Stores

Stores can be **paused**, **blocked**, or **hidden from browse** (`hiddenFromCustomers`, Admin/SuperAdmin): **blocked** stores never appear in public APIs; **hidden** stores are omitted from customer browse lists but are not the same as paused. **Paused** stores can still appear in `GET /api/stores` with `status: "paused"` (sorted after open stores). **Exclusive** / **premium** flags (`isExclusive` / `isPremium` — set together by admin) mark featured stores; use **`GET /api/stores/exclusive`** (or legacy **`/api/stores/premium`**) for that curated list.

Public listings use **`GET /api/stores`**, **`/api/stores/top-rated`**, **`/api/stores/premium`**, **`/api/stores/exclusive`**, **`/api/stores/category/:name`**, and **store products** — all exclude **blocked** and **hidden** stores. Each store includes **`paymentMethods`**: `{ "cod": true, "card": true, "cliq": true }` (cash on delivery, card, Cliq). If the field is omitted in storage, all three default to **`true`**. **`POST /api/checkout`** and **`POST /api/payment/initiate`** reject a **`paymentType`** the store has disabled. Admin APIs return full store records; **`PATCH /api/admin/stores/:id`** accepts **`paymentMethods`** (partial updates merge) and supports `paused`, `blocked`, `hiddenFromCustomers`, and **`isExclusive`** (SuperAdmin/Admin only).

### Get All Stores

Retrieves all stores that are **listed for customer browse** (not blocked, not hidden). Each store includes **`status`**: `"open"` | `"paused"` | `"closed"` (Jordan opening hours + admin toggles — see [Admin Stores](#admin-stores)).

**Endpoint:** `GET /api/stores`

**Authentication:** Not required

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "stores": [
      {
        "id": "1",
        "name": "كريسبي تشيكن",
        "nameAr": "كريسبي تشيكن",
        "nameEn": "Crispy Chicken",
        "logo": "https://example.com/stores/crispy.png",
        "cover": "https://example.com/stores/crispy_cover.jpg",
        "rate": 4.9,
        "numberOfReviews": 100,
        "deliveryFee": 2.5,
        "isOpen": true,
        "status": "open",
        "isExclusive": false,
        "isPremium": false,
        "closingTime": "23:00",
        "openingTime": "09:00",
        "storeCategories": [
          { "id": "1", "nameEn": "Meals", "nameAr": "وجبات", "name": "Meals" }
        ],
        "paymentMethods": {
          "cod": true,
          "card": true,
          "cliq": true
        }
      }
    ]
  }
}
```

Each store includes **`status`**, **`isExclusive`** / **`isPremium`** (same meaning — exclusive/premium tier), **`closingTime`** (string or `null`), **`openingTime`** (string or `null`), **`storeCategories`** (array of `{ id, nameEn, nameAr, name }`), and **`paymentMethods`** (`cod` = cash on delivery; use with `paymentType` **`cash`** or **`cod`** at checkout).

---

### Get Store Payment Methods

Returns which payment options are enabled for a single store (same flags as **`paymentMethods`** on **`GET /api/stores`**). **Blocked** or **hidden** stores return **404**.

**Endpoint:** `GET /api/stores/:id/payment-methods`

**Authentication:** Not required

**Success Response (200):**
```json
{
  "success": true,
  "message": "Store payment methods",
  "data": {
    "storeId": "1",
    "paymentMethods": {
      "cod": true,
      "card": true,
      "cliq": false
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Checkout mapping:** `paymentType` **`cash`** or **`cod`** → **`cod`**; **`card`** → **`card`**; **`cliq`** → **`cliq`** (case-insensitive).

---

### Get Top Rated Stores

Retrieves stores sorted by rating (highest first).

**Endpoint:** `GET /api/stores/top-rated?limit=10`

**Authentication:** Not required

**Query Parameters:**
- `limit` (optional) - Number of stores to return (default: all)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Top rated stores retrieved successfully",
  "data": {
    "stores": [
      {
        "id": "1",
        "name": "كريسبي تشيكن",
        "rate": 4.9,
        "numberOfReviews": 150
      }
    ],
    "count": 10,
    "limit": 10
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
// Get top 10 rated stores
const response = await fetch('https://arheb-backend.onrender.com/api/stores/top-rated?limit=10');
```

---

### Get Premium Stores

Retrieves stores marked as premium by SuperAdmin or Admin.

**Endpoint:** `GET /api/stores/premium?limit=10`

**Authentication:** Not required

**Query Parameters:**
- `limit` (optional) - Number of stores to return (default: all)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Premium stores retrieved successfully",
  "data": {
    "stores": [...],
    "count": 5,
    "limit": 10
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Note:** Only SuperAdmin or Admin can set a store as premium via `PATCH /api/admin/stores/:id` with `{ "isPremium": true }`. Store Admin cannot set premium.

---

### Get Exclusive Stores

Same behavior and payload as [Get Premium Stores](#get-premium-stores): returns stores with **`isExclusive`** / **`isPremium`** set (admin-curated list). Prefer this endpoint name; **`GET /api/stores/premium`** is an alias.

**Endpoint:** `GET /api/stores/exclusive?limit=10`

**Authentication:** Not required

---

### Get Stores by Category

Retrieves stores that match a category name (store-level category).

**Endpoint:** `GET /api/stores/category/:categoryName`

**Authentication:** Not required

**Path Parameters:**
- `categoryName` - Category name (case-insensitive, supports partial matching)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Stores by category retrieved successfully",
  "data": {
    "categoryName": "restaurant",
    "stores": [...],
    "count": 10
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Update Store FCM Token

Registers or updates the Firebase Cloud Messaging token for a **store** device (e.g. kitchen tablet). The token is saved in the server database and used to notify the store when a **new order** is placed for that `storeId`. Public store listing endpoints do **not** expose this token.

**Endpoint:** `POST /api/store/update-fcm`

**Authentication:** Not required (the `storeId` must match an existing store in the catalog).

**Request Body:**
```json
{
  "storeId": "1235",
  "fcmToken": "<device FCM registration token>"
}
```

- **`storeId`** (required) — Store id as in the stores JSON catalog.
- **`fcmToken`** (optional) — FCM token string. Send an empty string to clear the stored token for that store.

**Success Response (200):**
```json
{
  "success": true,
  "message": "FCM token updated",
  "data": { "storeId": "1235" }
}
```

**Error Responses:**
- **400** — `storeId` missing.
- **404** — Store id not found in the catalog.
- **500** — Server failed to persist the token.

**Admin visibility:** **GET /api/admin/stores** (list), **GET /api/admin/stores/:id**, and **PATCH /api/admin/stores/:id** responses include **`fcmToken`** (or `null` if unset) so the dashboard can show whether a device is registered.

---

### Get Store Products

Retrieves all products for a specific store.

**Endpoint:** `GET /api/stores/:id/products`

**Authentication:** Not required

**Path Parameters:**
- `id` - Store ID

**Success Response (200):**
```json
{
  "success": true,
  "message": "Store products retrieved successfully",
  "data": {
    "store": {
      "id": "1",
      "name": "كريسبي تشيكن",
      "nameAr": "كريسبي تشيكن",
      "nameEn": "Crispy Chicken",
      "logo": "https://example.com/stores/crispy.png",
      "cover": "https://example.com/stores/crispy_cover.jpg",
      "closingTime": "23:00",
      "openingTime": "09:00",
      "storeCategories": [
        { "id": "1", "nameEn": "Meals", "nameAr": "وجبات", "name": "Meals", "image": "https://firebasestorage.googleapis.com/..." }
      ]
    },
    "products": [
      {
        "id": "1",
        "name": "وجبة فردية",
        "price": 4.5
      }
    ],
    "count": 5
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Not Found Response (404):**
```json
{
  "success": false,
  "message": "Store not found"
}
```

---

### Get Store Products (paginated)

For stores with very large catalogs, use this endpoint instead of **`GET /api/stores/:id/products`**, which returns every product in one response.

**Endpoint:** `GET /api/stores/:id/products/paged`

**Query parameters:**
- **`page`** — Page number starting at **1** (default `1` if omitted or invalid).

**Behavior (same model as [paginated by store categories](#get-store-products-paginated-by-store-categories)):**
- Always includes **all** `store.storeCategories` plus an **`other`** bucket in **`data.categories`** (each with `total` and `items[]` for that page). Each non-`other` category object may include **`image`** when present on the store JSON entry — see [Store category tab images](#store-category-tab-images).
- **`data.products`** is a **flattened** list of the same items as in `categories[].items` (category order preserved), for clients that only read `products`.
- Each page returns up to **10** products **per active category** (categories that still have remaining products). When a category is exhausted it drops out of “active” for later pages; remaining categories keep getting up to 10 until the catalog is exhausted.
- Products are bucketed by matching product category fields to store categories (same rules as the category-specific endpoint); unmatched products go to **`other`**.

**Authentication:** Not required

**Success Response (200):** Same `data.store` shape as [Get Store Products](#get-store-products). `data.pagination` includes:

| Field | Description |
|--------|-------------|
| `page` | Current page |
| `perPage` / `perCategory` | Always **10** (max items per active category on this page) |
| `total` | Total available products (after the same filters as the non-paginated endpoint) |
| `totalPages` | Number of pages for this per-category paging model |
| `hasNextPage` | Whether a next page exists |
| `hasPrevPage` | Whether a previous page exists |
| `finished` | `true` when this page consumed the last remaining products (or when there were none) |

---

### Get Store Products (paginated by store categories)

For very large stores where you want to **render categories always** (and avoid pages that only show 1–2 categories), use this endpoint.

**Endpoint:** `GET /api/stores/:id/products/paged-categories`

**Query parameters:**
- **`page`** — Page number starting at **1** (default `1`). Each page returns up to **10 items per active category**.

**Behavior:**
- Always returns **all** `store.storeCategories` (plus an `other` bucket) on every page.
- Each page returns up to **10** products per category.
- When a category runs out of products, it stops contributing to next pages; the remaining categories continue to return 10 until all products are exhausted.

**Success Response (200):**
- `data.categories`: array of categories with `{ id, nameEn, nameAr, name, image?, total, items[] }` — **`image`** is included when the store’s **`storeCategories`** entry has **`image`** (or legacy **`imageUrl`**) set; see [Store category tab images](#store-category-tab-images).
- `data.pagination`: `{ page, perCategory: 10, perPage: 10, total, totalProducts, totalPages, hasNextPage, hasPrevPage, finished }`

---

### Store category tab images

Optional **HTTPS** image URLs on **`store.storeCategories`** entries (persisted in the stores JSON via **`PATCH /api/admin/stores/:id`**). Fields supported:

| Field | Meaning |
|-------|---------|
| **`image`** | Preferred download URL for the category tab / chip (shown to customers when returned). |
| **`imageUrl`** | Legacy alias — **`GET /api/stores/:id/products/paged`** and **`GET /api/stores/:id/products/paged-categories`** normalize this to **`image`** on **`data.categories`** only ( **`data.store.storeCategories`** keeps whatever keys were saved). |

The dashboard uploads binary files to **Firebase Storage** for selected stores, then saves **`image`** on save store — see [Admin Dashboard HTTP usage](#admin-dashboard-http-usage).

**Customer endpoints exposing category images:**

| Endpoint | Where `image` appears |
|----------|------------------------|
| **`GET /api/stores/:id/products/paged`** | **`data.categories[].image`** (each bucket except synthetic **`other`** only when configured). |
| **`GET /api/stores/:id/products/paged-categories`** | **`data.categories[].image`** (same rules). |
| **`GET /api/stores/:id/products`** | **`data.store.storeCategories[].image`** when saved on the store. |
| **`GET /api/stores/:id/products/category/:categoryName`** | **`data.store.storeCategories`** echoes stored objects. |
| **`GET /api/stores`** (list) | Each **`store.storeCategories`** entry may include **`image`** if present in JSON. |

---

### Get Store Products by Category

Retrieves all products for a specific store filtered by category name.

**Endpoint:** `GET /api/stores/:id/products/category/:categoryName`

**Authentication:** Not required

**Path Parameters:**
- `id` - Store ID
- `categoryName` - Category name (case-insensitive, supports partial matching)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Store products by category retrieved successfully",
  "data": {
    "store": {
      "id": "1",
      "name": "كريسبي تشيكن",
      "nameAr": "كريسبي تشيكن",
      "nameEn": "Crispy Chicken",
      "logo": "https://example.com/stores/crispy.png",
      "cover": "https://example.com/stores/crispy_cover.jpg",
      "category": "restaurant",
      "categoryAr": "مطعم",
      "categoryEn": "Restaurant",
      "closingTime": "23:00",
      "openingTime": "09:00",
      "storeCategories": [
        { "id": "1", "nameEn": "Meals", "nameAr": "وجبات", "name": "Meals" }
      ]
    },
    "categoryName": "restaurant",
    "products": [
      {
        "id": "1",
        "name": "وجبة فردية",
        "price": 4.5,
        "category": "restaurant"
      }
    ],
    "count": 10
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Error Responses:**
- `400` - Category name is required
- `404` - Store not found
- `500` - Products payload unavailable

**Note:**
- Category name matching is case-insensitive and supports partial matching
- Checks both product-level and store-level category fields
- Returns products that match the store ID and category name

**Example:**
```javascript
// Get products from store ID "1" with category "restaurant"
const response = await fetch('https://arheb-backend.onrender.com/api/stores/1/products/category/restaurant');
const data = await response.json();
console.log(data.data.products);
```

---

## Categories

### Get All Categories

Retrieves all categories and subcategories. The response automatically includes a virtual **"Offers"** category (id `"offers"`) as the first item when there are products with active discounts. The Offers category includes a `stores` array of all visible stores that have at least one discounted product, and `productsCount` / `storesCount` for display.

**Endpoint:** `GET /api/categories`

**Authentication:** Not required

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "id": "offers",
        "name": "Offers",
        "nameAr": "العروض",
        "nameEn": "Offers",
        "image": "",
        "isComingSoon": false,
        "order": 0,
        "subCategories": [],
        "stores": [
          {
            "id": "1",
            "name": "كريسبي تشيكن",
            "nameEn": "Crispy Chicken",
            "logo": "https://example.com/stores/crispy.png",
            "rate": 4.9,
            "status": "open"
          }
        ],
        "storesCount": 1,
        "productsCount": 5
      },
      {
        "id": "1",
        "name": "supermarket",
        "nameAr": "سوبر ماركت",
        "nameEn": "Supermarket",
        "image": "https://example.com/categories/supermarket.png",
        "subCategories": []
      }
    ]
  }
}
```

**Note:** The "Offers" category is only included when there are products with active discounts. Use `GET /api/offers` to get the actual discounted products. The `stores` array within the Offers category lets the client show which stores currently have offers.

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/categories');
const data = await response.json();
const offersCategory = data.data.categories.find(c => c.id === 'offers');
if (offersCategory) {
  console.log(`${offersCategory.storesCount} stores with ${offersCategory.productsCount} offers`);
  console.log(offersCategory.stores); // stores with active discounts
}
```

---

### Get Products by Category

Retrieves all products for a specific category across all stores.

**Endpoint:** `GET /api/categories/:categoryName/products`

**Authentication:** Not required

**Path Parameters:**
- `categoryName` - Category name (case-insensitive, supports partial matching)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Products by category retrieved successfully",
  "data": {
    "category": {
      "id": "1",
      "name": "supermarket",
      "nameAr": "سوبر ماركت",
      "nameEn": "Supermarket",
      "image": "https://example.com/categories/supermarket.png"
    },
    "categoryName": "supermarket",
    "products": [
      {
        "id": "1",
        "name": "Product Name",
        "price": 4.5,
        "store": {
          "id": "1",
          "name": "Store Name"
        }
      }
    ],
    "count": 25
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Error Responses:**
- `400` - Category name is required
- `500` - Products payload unavailable

**Note:**
- Category name matching is case-insensitive and supports partial matching
- Checks both product-level and store-level category fields
- Returns products from all stores that match the category
- If category exists in categories list, includes category information in response

**Example:**
```javascript
// Get all products in "supermarket" category
const response = await fetch('https://arheb-backend.onrender.com/api/categories/supermarket/products');
const data = await response.json();

if (data.success) {
  console.log(`Found ${data.data.count} products in ${data.data.categoryName} category`);
  console.log(data.data.products);
}
```

---

## Search

### Search Stores & Products

Searches stores and products by text. Returns stores whose name/category (EN/AR) contain the query, and products whose name/category contain the query. Stores and products are returned in separate lists.

**Visibility:** Results include only stores that are **open for customer browse**: **paused**, **merchant-closed** (`isOpen === false`), **outside Jordan opening hours**, **blocked**, or **hiddenFromCustomers** stores are **omitted**, and **no products** from those stores are returned. Each matched product’s nested **`store`** includes **`status`** and **`isOpen`** aligned with the canonical store record.

**Endpoint:** `GET /api/search?q=text`

**Authentication:** Not required

**Query Parameters:**
- `q` (or `query`) - Search text (case-insensitive, partial match)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Search results",
  "data": {
    "stores": [
      {
        "id": "1",
        "name": "Store Name",
        "nameAr": "اسم المتجر",
        "nameEn": "Store Name",
        "category": "restaurant",
        "logo": "https://...",
        "rate": 4.5
      }
    ],
    "products": [
      {
        "id": "1",
        "name": "Product Name",
        "nameAr": "اسم المنتج",
        "nameEn": "Product Name",
        "price": 4.5,
        "store": { "id": "1", "name": "Store Name" }
      }
    ]
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Empty Query:** If `q` is missing or empty, returns `{ data: { stores: [], products: [] } }`.

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/search?q=pizza');
const data = await response.json();
console.log(data.data.stores);   // Stores matching "pizza"
console.log(data.data.products); // Products matching "pizza"
```

---

## Home

Retrieves home page data including banners, categories (from categories API), popular stores, and offers. **Banners** and **`offers`** are editable by SuperAdmin/Admin via [Admin Home Banners & Offers](#admin-home-banners--offers) (`GET/PATCH /api/admin/home/banners` and `GET/PATCH /api/admin/home/offers`). Each banner/offer may include optional **`linkTarget`** (`"product"` \| `"category"` \| `"store"`) and **`linkTargetId`** (product id, category id, or store id) for in-app navigation. When the user is authenticated, the response may include **`activeOrders`** and **`activeOrder`** for every non-terminal store order and Arheb Box request (see SQL exclusions below). **`totalAmount`** on those objects is the **full amount to pay** (items/parcel subtotal + delivery + service + tax), not the items-only subtotal. The response also includes **`discountedProducts`**: a list of products that currently have a discount (same shape as in [Get Products](#get-products-paginated)).

**Endpoint:** `GET /api/home`

**Authentication:** Optional. If `Authorization: Bearer <token>` is sent and valid, **`activeOrders`** / **`activeOrder`** are included when the user has at least one **active** row: store orders whose status is not `Delivered`, `Cancelled`, or `Payment rejected` (case-insensitive), and Arheb Box requests whose status is not `delivered` or `cancelled`.

**Success Response (200):** Body is loaded from `home_response.json` (or the empty payload), then **`data.categories`** is replaced from **`categories_response.json`**, **`data.discountedProducts`** is injected from live product/store JSON, **`data.mostPopularStores`** may be filtered/sorted by visibility, and optional **`activeOrders`** / **`activeOrder`** are added at the **top level** of the JSON (next to **`success`**, **`message`**, **`data`**).

Typical shape:

```json
{
  "success": true,
  "message": "Home data retrieved successfully",
  "data": {
    "banners": [],
    "categories": [],
    "mostPopularStores": [],
    "offers": [],
    "discountedProducts": []
  },
  "timestamp": "2026-04-23T12:00:00.000Z"
}
```

Fields inside **`data`** match your CMS JSON (plus **`discountedProducts`** always present — possibly empty `[]`).

**With active order(s)** (authenticated user with at least one active order or box request):

```json
{
  "success": true,
  "message": "Home data retrieved successfully",
  "data": {
    "banners": [],
    "categories": [],
    "mostPopularStores": [],
    "offers": [],
    "discountedProducts": []
  },
  "timestamp": "2026-04-23T12:00:00.000Z",
  "activeOrders": [
    {
      "orderType": "store",
      "id": 42,
      "status": "Preparing",
      "createdAt": "2026-04-23T10:00:00.000Z",
      "totalAmount": 18.5,
      "itemsSubtotal": 15,
      "deliveryFee": 2,
      "serviceFee": 0.65,
      "feesTax": 0.85
    }
  ],
  "activeOrder": {
    "orderID": 42,
    "orderType": "store",
    "status": "Preparing",
    "totalAmount": 18.5,
    "itemsSubtotal": 15,
    "deliveryFee": 2,
    "serviceFee": 0.65,
    "feesTax": 0.85
  }
}
```

- **`totalAmount`**: Grand total in JOD — **`itemsSubtotal` + `deliveryFee` + `serviceFee` + `feesTax`** (same notion as checkout **`orderSummary.total`** for store orders).
- **`itemsSubtotal`**: For **`store`** orders this is the cart/items sum stored on the order row (historically labeled `totalAmount` in the DB). For **`arheb_box`** it is the parcel **`amount`** (declared value), before delivery/service/tax.

**Note:** **`activeOrder`** is the same entry as **`activeOrders[0]`** (most recently created among merged store + box rows). **`orderID`** matches **`id`** on the list entries.

**Example (with token):**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/home', {
  headers: { 'Authorization': 'Bearer your-jwt-token-here' }
});
const data = await response.json();
if (data.activeOrder) {
  console.log('Active order:', data.activeOrder.orderID, data.activeOrder.status, data.activeOrder.totalAmount);
}
```

---

## Profile

User profile includes a **list of addresses**. The **first address is the default**. Users can add, update, and delete addresses.

### Get Profile

Retrieves the authenticated user's profile (name and addresses list).

**Endpoint:** `GET /api/profile`

**Authentication:** Required (Bearer token)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "profile": {
      "phoneNumber": "+201500157920",
      "name": "John Doe",
      "addresses": [
        { "addressName": "Home", "addressLong": 35.0063, "addressLat": 29.5320 },
        { "addressName": "Work", "addressLong": 35.0100, "addressLat": 29.5350 }
      ],
      "defaultAddress": { "addressName": "Home", "addressLong": 35.0063, "addressLat": 29.5320 }
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### List user notification history (in-app inbox)

Returns **push notifications that were sent to this user** (order updates, near-arrival, broadcast “send to all”, etc.). Rows are stored when the backend sends FCM via `sendToUserByPhone` / broadcast. **Only the authenticated user’s rows** are returned (matched by `phoneNumber` from the Bearer JWT — same identity as when you register **`fcmToken`** on **PUT /api/profile**).

**Endpoint:** `GET /api/profile/notifications`

**Authentication:** Required (**Bearer** user JWT — not admin)

**Query parameters:**
- `page` (optional, default `1`)
- `perPage` (optional, default `20`, max `50`)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Notifications retrieved successfully",
  "data": {
    "notifications": [
      {
        "id": 1,
        "title": "Order confirmed",
        "body": "Order #12 is confirmed and preparing.",
        "imageUrl": null,
        "data": {
          "orderId": "12",
          "status": "Preparing",
          "type": "order_tracking",
          "screen": "order_details",
          "deepLink": "arheb://orders/12",
          "click_action": "FLUTTER_NOTIFICATION_CLICK"
        },
        "createdAt": "2026-03-26T12:00:00.000Z"
      }
    ],
    "page": 1,
    "perPage": 20,
    "total": 1
  },
  "timestamp": "2026-03-26T12:00:00.000Z"
}
```

The mobile app should use the same **Bearer token** as other user APIs; **`data`** mirrors the FCM `data` payload for deep links (`orderId`, `deepLink`, `type`, etc.).

---

### Update Profile (Name Only)

Updates the user's display name.

**Endpoint:** `PUT /api/profile`

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "name": "John Doe"
}
```

**Success Response (200):** Returns full profile (including addresses).

---

### Add Address

Adds a new address. Optionally set as default (inserted at first position).

**Endpoint:** `POST /api/profile/addresses`

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "addressName": "Work",
  "addressLong": 35.0100,
  "addressLat": 29.5350,
  "setAsDefault": false
}
```

- `addressLong`, `addressLat` (number) - Required.
- `addressName` (string) - Optional label.
- `setAsDefault` (boolean) - If true, new address is inserted as first (default). Default: false (append).

**Success Response (201):** Returns full profile with updated addresses.

---

### Update Address

Updates an address at the given index (0-based).

**Endpoint:** `PUT /api/profile/addresses/:index`

**Authentication:** Required (Bearer token)

**Path Parameters:** `index` - 0-based address index

**Request Body (all optional):**
```json
{
  "addressName": "Home Updated",
  "addressLong": 35.0065,
  "addressLat": 29.5325
}
```

**Success Response (200):** Returns full profile.

---

### Delete Address

Deletes the address at the given index (0-based). After deletion, the first remaining address becomes the default.

**Endpoint:** `DELETE /api/profile/addresses/:index`

**Authentication:** Required (Bearer token)

**Path Parameters:** `index` - 0-based address index

**Success Response (200):** Returns full profile with updated addresses.

---

## Checkout & Orders

### Quote Checkout Fees

Call **before** `POST /api/checkout` to preview **delivery fee**, **service fee**, and **fees tax** using **store-order** delivery rules (**not** the same per-km formula as [Arheb Box](#arheb-box)). **`feesTaxRate`** is currently **0** (no VAT on delivery + service in checkout). Delivery still follows platform tiers, optional platform **flat** delivery, **cart-threshold** rules (platform and per-store), and special zones (see [Admin platform checkout fees](#admin-platform-checkout-fees) and store `PATCH` fields below).

**Endpoint:** `POST /api/checkout/quote-fees`

**Authentication:** Required (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|--------|------|----------|-------------|
| `storeId` | string | Yes | Store id (must exist in `stores_listing_response.json`). |
| `storeLocation` | object | No | Optional. If sent, it can be used for client-side display only. Server resolves store location from `storeId` + store `mapsUrl` / store coordinates. |
| `deliveryLocation` | object | Yes | Customer drop-off: **`latitude`** and **`longitude`** (numbers). |
| `weightKg` | number | No | Echoed in the response for client convenience; **store delivery fee does not vary by weight** (weight is ignored for fee calculation). |
| `cartAmount` | number | No | **Items subtotal in JOD** (before delivery/service). When set, the server can apply **delivery fee when cart ≥ threshold** (per-store or platform-wide). Omit if unknown; threshold rules are skipped for quoting. |

**Example:**

```json
{
  "storeId": "1",
  "deliveryLocation": { "latitude": 29.54, "longitude": 35.01 },
  "weightKg": 2.5,
  "cartAmount": 24.5
}
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "storeId": "1",
    "storeName": "كريسبي تشيكن",
    "storeLocation": { "latitude": 29.532, "longitude": 35.006 },
    "distanceKm": 1.234,
    "deliveryFeeMaxJod": 3,
    "weightKg": 2.5,
    "currency": "JOD",
    "deliveryFee": 1.02,
    "serviceFee": 0.65,
    "feesTaxRate": 0,
    "feesTax": 0,
    "feesTaxNote": "No tax on delivery fee plus service fee.",
    "invoiceTotal": 1.67,
    "pricingNote": "…"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

- **`deliveryFee`**: Resolved from distance tiers, optional platform **`flatDeliveryFeeJod`**, optional **cart ≥ threshold** delivery (store or platform), per-store **fixed** / **free** checkout delivery, then special-far / uncapped / remote rules. See **`pricingNote`** in the live response for the active rule text.
- **`deliveryFeeMaxJod`**: Platform cap from [Admin platform checkout fees](#admin-platform-checkout-fees) (informational; some zones ignore the cap).
- **`serviceFee`**: Platform default or per-store override.
- **`feesTax`**: **`feesTaxRate × (deliveryFee + serviceFee)`**; rate is **0** in current builds.
- **`invoiceTotal`**: `deliveryFee + serviceFee + feesTax` (fees-only total; does **not** include cart subtotal).
- **`distanceKm`**: Haversine distance between resolved store location and `deliveryLocation` (informational).
- Store location is resolved server-side from the store record (`storeId`) using store lat/long if present, otherwise parsed from `mapsUrl`.

**Error responses:** `400` (missing/invalid body), `404` (unknown `storeId`), `500` (server error).

---

### Create Order

Creates a new order with items, customer information, and delivery details.

**Endpoint:** `POST /api/checkout`

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "items": [
    {
      "id": "1",
      "name": "وجبة فردية",
      "price": 4.5,
      "quantity": 2
    }
  ],
  "phoneNumber": "+201500157920",
  "name": "John Doe",
  "addressName": "Home Address",
  "addressLong": 35.0063,
  "addressLat": 29.5320,
  "discount": 2.0,
  "deliveryFee": 2.5,
  "totalAmount": 15.5,
  "paymentType": "cash",
  "promoCode": "SAVE10",
  "storeId": "1",
  "nearby": "Near the shopping mall",
  "notes": "Please call before delivery"
}
```

**Required Fields:**
- `items` (array) - Order items with `id`, `name`, `price`, `quantity`
- `phoneNumber` (string) - Customer phone number
- `totalAmount` (number) - Total order amount
- `deliveryFee` (number) - Delivery fee
- `paymentType` (string) - Payment method (e.g., "cash", "card")

**Optional Fields:**
- `name` (string) - Customer name
- `addressName` (string) - Address description
- `addressLong` (number) - Longitude
- `addressLat` (number) - Latitude
- `discount` (number) - Discount amount (ignored if `promoCode` is valid)
- `promoCode` (string) - Promo code (if valid, discount will be set from promo code value)
- `storeId` (string) - Store ID (auto-detected from first product if not provided)
- **`cartAmount` (number)** - Items **subtotal in JOD** before delivery/service/fees. Send with `promoCode` when the code has a **minimum order amount** (`minOrderAmount`); also used to resolve **delivery fee when cart ≥ threshold** (same as [Quote Checkout Fees](#quote-checkout-fees)). If omitted, promos with a minimum may be rejected and cart-based delivery rules are not applied.
- `nearby` (string) - Nearby landmark
- `notes` (string) - Additional notes

**Note:** 
- Status is automatically set to "Waiting confirmation"
- **`paymentType`** must be allowed for the order’s store: **`cash`** / **`cod`** (COD), **`card`**, or **`cliq`**, matching **`paymentMethods`** on the store (see [Get Store Payment Methods](#get-store-payment-methods)). If disabled, the API returns **400** with a clear message.
- If `promoCode` is provided and valid, the discount will be automatically applied from the promo code value. **Store-specific** promo codes (see [Admin promo codes](#admin-promo-codes)) only apply when the order’s store (from `storeId` or inferred from cart items) matches that promo’s store; otherwise the request fails with **`promo code not available for this store`**. If the promo has **`minOrderAmount`**, the client must send **`cartAmount`** ≥ that threshold (or the request fails).
- If `promoCode` is invalid, order creation will fail with **`invalid promoCode`**

**Success Response (201):**
```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "orderId": 1,
    "order": {
      "id": 1,
      "phoneNumber": "+201500157920",
      "discount": 10.0,
      "promoCode": "SAVE10",
      "orderRating": 0,
      "status": "Waiting confirmation",
      "items": [...],
      "createdAt": "2024-01-15T10:30:00Z"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "invalid promoCode"
}
```

---

### Get All Orders

Retrieves **all** orders for the authenticated user. Every status is included (e.g. **Waiting confirmation**, **Preparing**, **On the way**, **Delivered**, **Cancelled**). Use this list in the customer app so that orders in "Preparing" are visible.

**Endpoint:** `GET /api/checkout`

**Authentication:** Required (Bearer token)

Each order includes `status`, `storeId`, `driverId`, `driverName` (when assigned), and `items`.

The same response also includes **`arhebBoxRequests`**: all **Arheb Box** requests for this user (matched by JWT `phoneNumber` and/or `userId`), same shape as `GET /api/arheb-box/:id` (pickup/dropoff with `mapsUrl`, `amount`, `paymentMethod`, `whoPays`, `driverPhone` when assigned, etc.), plus **`arhebBoxCount`**.

**`combinedOrders`** merges **store** rows and **Arheb Box** rows in one list, sorted by **`createdAt`** (newest first). Each item is the usual store order or box object with an extra **`orderType`**: `"store"` or `"arheb_box"`. Use this for a single “My orders” screen; **`orders`** and **`arhebBoxRequests`** remain for clients that already consume them separately. **`combinedCount`** is `combinedOrders.length`.

Store rows are loaded when **`orders.userId`** or **`orders.phoneNumber`** matches the authenticated user (covers legacy rows that only stored phone).

**Success Response (200):**
```json
{
  "success": true,
  "message": "Orders retrieved successfully",
  "data": {
    "orders": [
      {
        "id": 1,
        "phoneNumber": "+201500157920",
        "totalAmount": 15.5,
        "status": "Waiting confirmation",
        "orderRating": 0,
        "promoCode": "SAVE10",
        "items": [...],
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "count": 5,
    "arhebBoxRequests": [],
    "arhebBoxCount": 0,
    "combinedOrders": [],
    "combinedCount": 5
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Get Order by ID (live status)

Retrieves a specific order by ID with **current status**. Use this so the customer can track their order by order ID and always see live status. Only returns orders belonging to the authenticated user.

**Endpoints (both return the same order with live status):**
- `GET /api/checkout/:orderId`
- `GET /api/orders/:orderId`

**Authentication:** Required (Bearer token)

**Path Parameters:**
- `orderId` - Order ID

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order retrieved successfully",
  "data": {
    "order": {
      "id": 1,
      "phoneNumber": "+201500157920",
      "totalAmount": 15.5,
      "status": "Waiting confirmation",
      "orderRating": 5,
      "promoCode": "SAVE10",
      "items": [...]
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Access Denied Response (403):**
```json
{
  "success": false,
  "message": "Access denied"
}
```

---

### Rate Order

Rates an order (1-5) and updates the store's average rating.

**Endpoint:** `PUT /api/checkout/:orderId/rate`

**Authentication:** Required (Bearer token)

**Path Parameters:**
- `orderId` - Order ID

**Request Body:**
```json
{
  "rating": 5
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order rated successfully",
  "data": {
    "order": {
      "id": 1,
      "orderRating": 5,
      ...
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Error Responses:**
- **403:** `"Can't rate this order"` (order doesn't belong to user)
- **400:** `"Rating must be an integer between 1 and 5"`

**Note:** 
- Rating automatically updates the store's average rating
- Formula: `(oldRate × oldNumberOfReviews + newRating) / (oldNumberOfReviews + 1)`
- Store's `numberOfReviews` is incremented by 1

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/checkout/1/rate', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-jwt-token-here'
  },
  body: JSON.stringify({ rating: 5 })
});
```

---

### Rate Driver (Customer)

After delivery, the customer can rate the **assigned driver** (1–5 stars) once per order. This updates the driver’s **average rating** and **rating count**; it does **not** affect the store’s product rating (see [Rate Order](#rate-order) for store ratings).

**Endpoint:** `POST /api/orders/:orderId/rate-driver`

**Authentication:** Required (Bearer user JWT — same token as other customer APIs)

**Path parameters:** `orderId` – numeric order ID (same order the user placed)

**Request body:**
```json
{
  "rating": 5,
  "notes": "Optional short comment"
}
```

- **`rating`** (required): integer **1–5** (whole stars)
- **`notes`** (optional): string (trimmed, max ~2000 chars server-side)

**Rules (enforced server-side):**
- The order must belong to the caller: **`order.userId`** matches the JWT **`userId`**, or **`order.phoneNumber`** matches the JWT **`phoneNumber`**.
- Order **`status`** must be **`Delivered`** (comparison is case-insensitive; leading/trailing spaces ignored). The order must have a **`driverId`** (driver was assigned for that delivery).
- **At most one driver rating per order:** if a row already exists in **`driver_ratings`** for this `orderId`, the API returns **400** (“already rated”).

**How the driver score is updated:**
1. A row is inserted into **`driver_ratings`** (`orderId`, `userId`, `driverId`, `rating`, optional `notes`).
2. The server recomputes **`AVG(rating)`** and **`COUNT(*)`** over **all** `driver_ratings` rows for that **`driverId`**.
3. **`drivers.rating`** is set to that average (rounded to 2 decimals) and **`drivers.ratingCount`** to that count.

So the stored average always matches the arithmetic mean of every per-order rating for that driver (equivalent to incrementally combining old average × count with the new star rating).

**Success (201):**
```json
{
  "success": true,
  "message": "Thank you for your feedback",
  "data": {
    "orderId": 42,
    "driverId": 3,
    "rating": 5,
    "driverRatingAvg": 4.85,
    "driverRatingCount": 120
  }
}
```

**Errors:** `400` (wrong status / no driver / invalid rating / already rated), `403` (not your order), `404` (order not found).

**Driver app:** Drivers see **average rating** (and aggregate stats where returned); they do **not** receive per-customer review text in the public driver profile payload. **Admin dashboard** can list full rating rows (order id, stars, notes, date) on the driver profile API.

---

### Cancel Order (Customer)

Allows a customer to cancel their own order. Only works when the order status is **Waiting confirmation**, **Waiting cliq confirmation**, **Pending payment**, or **Preparing**.

**Endpoint:** `POST /api/orders/:orderId/cancel`

**Authentication:** Required (Bearer token)

**Path Parameters:**
- `orderId` - Order ID

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order #123 has been cancelled",
  "data": {
    "orderId": 123,
    "status": "Cancelled"
  }
}
```

**Error Responses:**
- `400` - Order status is On the way / Delivered / Cancelled (cannot cancel)
- `403` - Order does not belong to the authenticated user
- `404` - Order not found

**Note:** Once an order is **On the way** or **Delivered**, the customer cannot cancel. They should contact support.

---

## Payment (Card / Online)

Online card payments are processed via **Madfoat (PayTabs)**. The flow is:

1. Client calls **POST /api/payment/initiate** with **`checkout`** (same as POST /api/checkout) → server creates order (`Pending payment`, `paymentType: Card`) → receives **`data.checkout`** + **`data.payment`** (including `redirectUrl` when needed).
2. Client opens the `redirectUrl` in a browser/WebView for the customer to enter card details (hosted payment page).
3. After 3DS / card entry, Madfoat sends a **server-to-server callback** to `POST /api/payment/callback` with the result.
4. The customer's browser is redirected to `GET /api/payment/return` which shows a success/failure page.
5. Client can query status via **GET /api/payment/query/:tranRef** at any time.

**Test credentials:**

| | Value |
|---|---|
| Profile ID | `47145` |
| Server Key | `S9JNLKHZRK-JMRR6BJ2RN-DZ69WH62JK` |
| Client Key | `CBKMDV-VR626N-RRG26M-HBNT7P` |

**Test Card:**

| Card Number | Scheme | CVV | 3D Enrolled |
|---|---|---|---|
| `4000000000000002` | Visa | `123` | Yes |

Use any future expiry (e.g. `12/2027`).

---

### Get Client Key

Returns the client key and profile ID for frontend managed-form integration (paylib.js).

**Endpoint:** `GET /api/payment/client-key`

**Authentication:** Not required

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "clientKey": "CBKMDV-VR626N-RRG26M-HBNT7P",
    "profileId": 47145
  }
}
```

---

### Initiate Payment

Creates the **order** (same rules as **POST /api/checkout**) and starts a **card** payment with Madfoat. **`paymentType` is always set to `Card` on the server** — do not send it in `checkout`. The amount charged is always the **saved order `totalAmount`** (not a separate `amount` field).

The order is created first with status **`Pending payment`**. After a successful payment (immediate or via callback), status becomes **`Waiting confirmation`**. If Madfoat rejects the payment request, the order is **rolled back** (deleted).

**Endpoint:** `POST /api/payment/initiate`

**Authentication:** Required (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `checkout` | object | **Yes** | Same fields as [Create Order](#create-order): `items`, `phoneNumber`, `totalAmount`, optional `name`, `addressName`, `addressLong`, `addressLat`, `storeId`, `promoCode`, `discount`, `notes`, `nearby`, `weightKg`, `fcmToken`, etc. **Do not send `paymentType`.** |
| `currency` | string | No | PayTabs 3-char currency (default: `JOD`) |
| `description` | string | No | Cart description on payment page (default: `Arheb Order #<id>`) |
| `customerName` | string | No | Overrides / supplements PayTabs customer (else uses order name) |
| `customerEmail` | string | No | PayTabs customer email |
| `customerPhone` | string | No | Overrides phone on PayTabs form (else uses order `phoneNumber`) |
| `customerAddress` | string | No | Street |
| `customerCity` | string | No | City |
| `customerCountry` | string | No | Country code (e.g. `JO`) |

**Example Request:**

```json
{
  "checkout": {
    "items": [
      { "id": "1", "name": "وجبة فردية", "price": 4.5, "quantity": 2 }
    ],
    "phoneNumber": "+962791111111",
    "name": "Ahmad",
    "addressName": "Home",
    "addressLong": 35.91,
    "addressLat": 31.95,
    "totalAmount": 15.5,
    "storeId": "1",
    "weightKg": 0
  },
  "currency": "JOD",
  "customerEmail": "ahmad@example.com",
  "customerCity": "Amman",
  "customerCountry": "JO"
}
```

**Success Response (201):** Combined **checkout** payload (same shape as **POST /api/checkout** `data`) and **payment** block. The created order includes **`paymentTranRef`** and **`paymentCartId`** once PayTabs returns a reference.

```json
{
  "success": true,
  "message": "Order created; redirect customer to complete card payment",
  "data": {
    "checkout": {
      "orderId": 42,
      "order": {
        "id": 42,
        "status": "Pending payment",
        "paymentType": "Card",
        "paymentTranRef": "TST2014900000688",
        "paymentCartId": "ORDER-42-1712160000000",
        "totalAmount": 15.5,
        "items": []
      }
    },
    "payment": {
      "tranRef": "TST2014900000688",
      "cartId": "ORDER-42-1712160000000",
      "cartAmount": 15.5,
      "cartCurrency": "JOD",
      "status": "pending_redirect",
      "redirectUrl": "https://madfoat-secure.paytabs.com/payment/page/REF/redirect",
      "redirectMethod": "GET"
    }
  },
  "timestamp": "2026-04-03T12:00:00.000Z"
}
```

Open `data.payment.redirectUrl` in a browser or WebView when `status` is `pending_redirect`. After the customer pays, Madfoat calls **`POST /api/payment/callback`** and the order moves to **`Waiting confirmation`**.

**Direct success (201)** when PayTabs authorises without redirect: `data.payment.status` is `completed` and `data.checkout.order.status` is `Waiting confirmation`.

**Error Response (400/500):**

```json
{
  "success": false,
  "message": "Invalid currency code",
  "code": 206
}
```

**Example (JavaScript):**

```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/payment/initiate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-jwt-token-here'
  },
  body: JSON.stringify({
    checkout: {
      items: [{ id: '1', name: 'Meal', price: 4.5, quantity: 2 }],
      phoneNumber: '+962791111111',
      totalAmount: 15.5,
      addressLong: 35.91,
      addressLat: 31.95,
      storeId: '1',
      weightKg: 0
    },
    customerEmail: 'ahmad@example.com',
    customerCountry: 'JO'
  })
});

const data = await response.json();
const pay = data.data?.payment;
const orderId = data.data?.checkout?.orderId;
const tranRef = pay?.tranRef;
if (pay?.redirectUrl) {
  window.open(pay.redirectUrl);
}
```

---

### Payment Callback

Server-to-server POST from Madfoat after a redirected payment completes. **Not called by the client.** The server verifies the HMAC signature and updates the payment and order status.

**Endpoint:** `POST /api/payment/callback`

**Content-Type:** `application/x-www-form-urlencoded`

**Parameters (form fields):**

| Field | Type | Description |
|---|---|---|
| `tranRef` | string | Transaction reference |
| `cartId` | string | Cart ID |
| `respStatus` | string | `A` = Approved, `D` = Declined |
| `respCode` | string | Response code |
| `respMessage` | string | Response message |
| `acquirerRRN` | string | Acquirer reference |
| `acquirerMessage` | string | Acquirer message |
| `token` | string | Tokenization identifier |
| `customerEmail` | string | Customer email |
| `signature` | string | HMAC-SHA256 signature for verification |

**Response:** `200 OK` with `{ success: true }`.

---

### Payment Return

Browser redirect URL after customer completes payment on the hosted page. Shows a simple HTML result page (success or failure). **Not an API endpoint for the client to call directly** — this is the URL Madfoat redirects the browser to.

**Endpoint:** `GET /api/payment/return`

**Query Parameters:** `tranRef`, `respStatus`, `respMessage` (sent by Madfoat)

**Response:** HTML page indicating payment success or failure.

---

### Query Transaction

Look up a payment transaction status by its transaction reference. Updates the local DB with latest info from Madfoat.

**Endpoint:** `GET /api/payment/query/:tranRef`

**Authentication:** Required (Bearer token)

**Path Parameters:**
- `tranRef` — Transaction reference (e.g. `TST2014900000688`)

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "tranRef": "TST2014900000688",
    "cartId": "ORDER-42-1712160000000",
    "cartAmount": "15.5",
    "cartCurrency": "JOD",
    "status": "completed",
    "paymentResult": {
      "response_status": "A",
      "response_code": "831000",
      "response_message": "Authorised",
      "acquirer_message": "ACCEPT",
      "acquirer_rrn": "014910159369",
      "transaction_time": "2026-04-03T14:35:38+03:00"
    },
    "paymentInfo": {
      "card_type": "Credit",
      "card_scheme": "Visa",
      "payment_description": "4000 00## #### 0002"
    },
    "customerDetails": {
      "name": "Ahmad",
      "email": "ahmad@example.com",
      "phone": "+962791111111"
    }
  }
}
```

**Example:**

```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/payment/query/TST2014900000688', {
  headers: { 'Authorization': 'Bearer your-jwt-token-here' }
});
const data = await response.json();
console.log(data.data.status); // "completed", "declined", "pending"
```

---

### Refund Transaction

Issues a full or partial refund for a completed transaction.

**Endpoint:** `POST /api/payment/refund`

**Authentication:** Required (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `tranRef` | string | Yes | Transaction reference to refund |
| `amount` | number | No | Refund amount (defaults to original amount if omitted) |
| `description` | string | No | Refund description |

**Example Request:**

```json
{
  "tranRef": "TST2014900000688",
  "amount": 5.0,
  "description": "Partial refund for item return"
}
```

**Success Response (200):**

```json
{
  "success": true,
  "message": "Refund processed successfully",
  "data": {
    "originalTranRef": "TST2014900000688",
    "refundTranRef": "TST2014900000689",
    "amount": 5.0,
    "status": "refunded",
    "paymentResult": {
      "response_status": "A",
      "response_code": "831000",
      "response_message": "Authorised"
    }
  }
}
```

---

### List Payment Transactions

Retrieves payment transaction history with optional filters.

**Endpoint:** `GET /api/payment/transactions`

**Authentication:** Required (Bearer token)

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `orderId` | number | — | Filter by order ID |
| `status` | string | — | Filter by status (`initiated`, `pending_redirect`, `completed`, `declined`, `refunded`) |
| `page` | number | 1 | Page number |
| `perPage` | number | 20 | Items per page (max 50) |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": 1,
        "orderId": 42,
        "tranRef": "TST2014900000688",
        "cartId": "ORDER-42-1712160000000",
        "cartAmount": 15.5,
        "cartCurrency": "JOD",
        "tranType": "sale",
        "status": "completed",
        "responseStatus": "A",
        "responseMessage": "Authorised",
        "paymentDescription": "4000 00## #### 0002",
        "cardScheme": "Visa",
        "cardType": "Credit",
        "createdAt": "2026-04-03T14:35:38",
        "updatedAt": "2026-04-03T14:35:40"
      }
    ],
    "total": 1,
    "page": 1,
    "perPage": 20
  }
}
```

---

### Payment Flow (Mobile App Integration)

```
┌─────────┐     POST /api/payment/initiate     ┌─────────┐
│  Mobile  │ ──────────────────────────────────> │ Backend │
│   App    │ <────────── { redirectUrl } ─────── │         │
│          │                                     │         │
│  Opens   │ ──── browser/WebView ──────────> ┌──┴─────────┴──┐
│ redirect │                                  │  Madfoat Page  │
│          │                                  │  (Card Entry)  │
│          │                                  └──┬─────────┬──┘
│          │                                     │ 3DS etc │
│          │   POST /api/payment/callback        │         │
│          │   (server-to-server)                 ▼         │
│          │                              ┌─────────┐      │
│          │                              │ Backend  │      │
│          │                              │ updates  │      │
│          │                              │ DB/order │      │
│          │                              └─────────┘      │
│          │   GET /api/payment/return (browser redirect)   │
│          │ <──────────────────────────────────────────────┘
│          │
│  Polls   │  GET /api/payment/query/:tranRef
│  status  │ ──────────────────────────────────> Backend
└─────────┘
```

---

## Order Tracking

### Get tracking status (REST, includes live order status)

**Endpoint:** `GET /api/orders/:orderId/tracking`

**Authentication:** Required (Bearer token)

Returns the current tracking state and **live order status** so the customer can poll by order ID and show both status and driver location. Response includes `data.status` (e.g. Preparing, On the way, Delivered), `data.location` (when driver is connected), and `data.isTracking`, `data.driverConnected`.

---

### Order Tracking (WebSocket)

The Order Tracking system allows real-time tracking of orders using WebSocket connections. Drivers send location updates every 3 seconds, and customers receive these updates in real-time to track their delivery.

**Two ways drivers can publish location (both update the same live map for customers/admins):**

1. **Order tracking socket (default namespace)** — connect with driver JWT + `orderId`, then emit **`driver_location`** `{ longitude, latitude }`.
2. **Driver presence only** — connect to **`/driver-presence`** and emit **`location`** `{ latitude, longitude }` (typical when the driver app is online but not joined per-order). The server forwards location to all **On the way** orders assigned to that driver, broadcasting **`location_update`** to the same `order:{orderId}` rooms.

Customer JWTs include **`userId`** (and `phoneNumber`) so WebSocket auth matches `orders.userId` for tracking.

### Connection

To connect to the order tracking system, you need to establish a WebSocket connection with authentication.

**WebSocket URL:** `wss://arheb-backend.onrender.com` (or `ws://localhost:4000` for local development)

**Connection Requirements — store orders:**
- `token` — Bearer JWT (customer, driver, or admin).
- `orderId` — Numeric ID from the **`orders`** table (store checkout order).

**Arheb Box** uses the **same WebSocket URL and default namespace** but a different handshake (see [Arheb Box real-time tracking (Socket.IO)](#arheb-box-real-time-tracking-socketio) below). Sending only `orderId` set to a box request id **without** `requestId` or `trackingType` will make the server look up a **store** order and fail.

**Connection Example (Socket.IO, store order):**
```javascript
const socket = io('https://arheb-backend.onrender.com', {
  auth: {
    token: 'Bearer your-jwt-token-here',
    orderId: 1
  }
});
```

**Connection Events:**
- `connect` - Fired when connection is established
- `connected` - Server confirmation with role information
- `error` - Connection/authentication errors
- `disconnect` - Connection closed

**Connection Response:**
```javascript
socket.on('connected', (data) => {
  console.log(data);
  // {
  //   role: 'driver' | 'customer',
  //   orderId: 1,
  //   message: 'Connected to order tracking'
  // }
});
```

---

### Arheb Box real-time tracking (Socket.IO)

**Yes — the handshake changed** for Arheb Box so clients can use either a dedicated **`requestId`** or reuse **`orderId`** together with an explicit **type** (useful when the mobile app only has one “id” field).

**Handshake `auth` (default namespace, same URL as store tracking):**

| Field | When |
|--------|------|
| `token` | **Required.** `Bearer …` customer JWT, driver JWT, or admin JWT (same as store). |
| `requestId` | **Optional.** If set, the connection is **always** Arheb Box; value = **`arheb_box_requests.id`**. |
| `orderId` | **Store:** required; must be an **`orders.id`**. **Box:** use as the box request id **only if** you also send `trackingType` / `orderType` (below). |
| `trackingType` **or** `orderType` | **Optional.** If set to **`arheb_box`** (also accepted: `arhebbox`, `arheb box`, `box`), then `orderId` is treated as the **box request id** (same numeric id as `requestId`). |

**Valid combinations:**

1. **Recommended (clearest):** `{ token, requestId: <boxRequestId> }`
2. **Same shape as store, different meaning:** `{ token, orderId: <boxRequestId>, trackingType: 'arheb_box' }`  
   (You can use `orderType: 'arheb_box'` instead of `trackingType`.)

**`connected` event (Arheb Box):** includes `requestId`, `trackingType: 'arheb_box'`, and `role`.

**`location_update` (Arheb Box):** payload uses **`requestId`**, not `orderId`:

```json
{
  "requestId": 42,
  "longitude": 35.0063,
  "latitude": 29.5320,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

Drivers still emit **`driver_location`** with `{ longitude, latitude }` (or `lat` / `lng` aliases). Live forwarding from **`/driver-presence`** applies while the box is in **`driver_to_pick`**, **`on_the_way`**, legacy **`in_progress`**, or **`assigned`** (see server: driver presence → box rooms).

**REST (poll, customer app):** `GET /api/arheb-box/:id/tracking` — Bearer token; **`id`** = box request id; user must own the request (`phoneNumber` match).

**REST (admin dashboard):** `GET /api/admin/orders/:requestId/tracking?type=arheb_box` — **`requestId`** is the Arheb Box id; response includes `requestId`, `orderType: 'arheb_box'`, `lastLocation`, etc.

**Server debug (Render / env):** set **`ARHEB_DEBUG=1`** to log extra lines prefixed with **`[arheb-debug]`** (driver offer chain, per-driver FCM attempts/skips, customer “request received” attempts). **`FCM_DEBUG=1`** adds Firebase send details from **`[fcm]`** logs.

---

### Driver Events

Drivers send location updates to the server, which are then broadcasted to connected customers.

#### Send Driver Location

**Event:** `driver_location`

**Frequency:** Every 3 seconds (client-side implementation)

**Payload:**
```json
{
  "longitude": 35.0063,
  "latitude": 29.5320
}
```

**Example:**
```javascript
// Connect as driver
const socket = io('https://arheb-backend.onrender.com', {
  auth: {
    token: 'Bearer your-jwt-token-here',
    orderId: 1
  }
});

socket.on('connected', (data) => {
  console.log('Connected as driver');
  
  // Send location every 3 seconds
  setInterval(() => {
    socket.emit('driver_location', {
      longitude: 35.0063,
      latitude: 29.5320
    });
  }, 3000);
});

// Receive confirmation
socket.on('location_sent', (data) => {
  console.log('Location sent:', data);
  // { success: true, message: 'Location updated successfully' }
});

// Handle errors
socket.on('error', (error) => {
  console.error('Error:', error.message);
});
```

**Location Sent Confirmation:**
```javascript
socket.on('location_sent', (data) => {
  // {
  //   success: true,
  //   message: 'Location updated successfully'
  // }
});
```

**Note:** 
- Only users who are NOT the order owner (customer) can connect as driver
- Coordinates must be valid numbers (longitude, latitude)
- Invalid coordinates will return an error

---

### Customer Events

Customers receive real-time location updates from the driver.

#### Receive Location Updates

**Event:** `location_update`

**Payload:**
```json
{
  "orderId": 1,
  "longitude": 35.0063,
  "latitude": 29.5320,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Example:**
```javascript
// Connect as customer (order owner)
const socket = io('https://arheb-backend.onrender.com', {
  auth: {
    token: 'Bearer your-jwt-token-here',
    orderId: 1
  }
});

socket.on('connected', (data) => {
  console.log('Connected as customer');
  
  // If driver already sent location, last known location is received
  if (data.lastLocation) {
    console.log('Last known location:', data.lastLocation);
  }
});

// Receive location updates
socket.on('location_update', (data) => {
  console.log('Driver location:', data);
  // {
  //   orderId: 1,
  //   longitude: 35.0063,
  //   latitude: 29.5320,
  //   timestamp: "2024-01-15T10:30:00.000Z"
  // }
  
  // Update map marker
  updateMapMarker(data.latitude, data.longitude);
});

// Handle errors
socket.on('error', (error) => {
  console.error('Error:', error.message);
});
```

**Note:**
- Only the order owner (customer) can connect as customer
- Customers receive the last known location upon connection (if available)
- Location updates are received every 3 seconds when driver sends updates
- Multiple customers can track the same order

---

### Get Tracking Status

Retrieves the current tracking status for an order (REST endpoint).

**Endpoint:** `GET /api/orders/:orderId/tracking`

**Authentication:** Required (Bearer token)

**Path Parameters:**
- `orderId` - Order ID

#### Arheb Box (customer REST) — same id as “orders” path

If the app already calls **`GET /api/orders/:orderId`** for the tracking screen, pass a **query flag** so the id is resolved from **`arheb_box_requests`** (not **`orders`**):

- **`GET /api/orders/:orderId?trackingType=arheb_box`** (also `type=arheb_box`, `orderType=arheb_box`, `arhebbox`, `box`)
- Response: `data.order` with **`orderType: 'arheb_box'`** (enriched box payload, same idea as **`GET /api/arheb-box/:id`**).

**Tracking poll:**

- **`GET /api/orders/:orderId/tracking?trackingType=arheb_box`** — same query keys; returns `requestId`, `orderType`, `status`, `location`, etc.

Alternatively, use the dedicated endpoints: **`GET /api/arheb-box/:id`** and **`GET /api/arheb-box/:id/tracking`**.

**Endpoint:** `GET /api/arheb-box/:id/tracking`

- **`id`** — Arheb Box request id (same as Socket.IO `requestId`).
- **Auth:** customer Bearer token; must match **`arheb_box_requests.phoneNumber`** for that row.
- Response shape includes `data.requestId`, `data.status`, `data.location`, `data.driverConnected`, etc.

#### Arheb Box (admin REST)

**Endpoint:** `GET /api/admin/orders/:requestId/tracking?type=arheb_box`

- **`requestId`** — Arheb Box id in the path (same numeric id as customer/socket).
- Query **`type=arheb_box`** is required so the server uses box tracking state, not the **`orders`** table.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Tracking data retrieved successfully",
  "data": {
    "orderId": 1,
    "isTracking": true,
    "location": {
      "longitude": 35.0063,
      "latitude": 29.5320,
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    "driverConnected": true,
    "customerConnected": false
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**No Tracking Data Response:**
```json
{
  "success": true,
  "message": "No tracking data available yet",
  "data": {
    "orderId": 1,
    "isTracking": false,
    "location": null
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Access Denied Response (403):**
```json
{
  "success": false,
  "message": "Access denied"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/orders/1/tracking', {
  headers: {
    'Authorization': 'Bearer your-jwt-token-here'
  }
});

const data = await response.json();
console.log(data);
```

---

### Complete Example: Driver and Customer

**Driver Side (Sending Locations):**
```javascript
const socket = io('https://arheb-backend.onrender.com', {
  auth: {
    token: 'Bearer driver-jwt-token',
    orderId: 1
  }
});

socket.on('connected', (data) => {
  if (data.role === 'driver') {
    // Start sending location updates every 3 seconds
    const interval = setInterval(() => {
      // Get current GPS coordinates (in production, use device GPS)
      const location = getCurrentLocation(); // Your GPS implementation
      
      socket.emit('driver_location', {
        longitude: location.longitude,
        latitude: location.latitude
      });
    }, 3000);
    
    // Clean up on disconnect
    socket.on('disconnect', () => {
      clearInterval(interval);
    });
  }
});
```

**Customer Side (Receiving Locations):**
```javascript
const socket = io('https://arheb-backend.onrender.com', {
  auth: {
    token: 'Bearer customer-jwt-token',
    orderId: 1
  }
});

socket.on('connected', (data) => {
  if (data.role === 'customer') {
    console.log('Tracking order', data.orderId);
    
    // Initialize map
    initializeMap();
  }
});

socket.on('location_update', (data) => {
  // Update map marker with driver location
  updateDriverMarker(data.latitude, data.longitude);
  
  // Update UI
  document.getElementById('driver-location').textContent = 
    `Driver: ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`;
  document.getElementById('last-update').textContent = 
    `Updated: ${new Date(data.timestamp).toLocaleTimeString()}`;
});
```

---

### WebSocket Connection States

| State | Description |
|-------|-------------|
| `connected` | Successfully connected and authenticated |
| `disconnect` | Connection closed (driver/customer disconnected) |
| `error` | Connection or authentication error |

### Error Handling

**Authentication Errors:**
- `Authentication failed: Token and orderId are required` (store order, or box without `requestId` / `trackingType`)
- `Authentication failed: Token and orderId (or requestId / trackingType for Arheb Box) are required`
- `Authentication failed: Invalid request id for Arheb Box tracking`
- `Authentication failed: Invalid token`
- `Order not found`
- `Arheb Box request not found`
- `Unauthorized: You are not authorized to track this order`
- `Access denied: You can only track requests assigned to you` (box + driver)

**Driver Location Errors:**
- `Only drivers can send location updates`
- `Invalid coordinates`

**Customer Errors:**
- `Access denied` (not order owner)

---

## Promo Codes

Promo codes are stored in the database. Each code has a **discount value** (JOD), optionally a **`storeId`** (restrict to one store vs all stores), and optionally **`minOrderAmount`** (JOD): when set, the code applies only if the cart subtotal is **≥** that amount. Admins configure codes via [Admin promo codes](#admin-promo-codes). Clients should send **`cartAmount`** (items subtotal) on validation and at checkout when using minimum-order promos.

### Validate Promo Code

Validates a promo code and returns its discount value.

**Endpoint:** `GET /api/promo-codes/:code`

**Authentication:** Not required

**Path Parameters:**
- `code` - Promo code name

**Query Parameters (optional):**
- **`storeId`** - If provided, the code must be either **all-stores** (`storeId` null on the promo row) or **for this exact store**. If the code exists but is restricted to another store, the API returns **404** with message **`promo code not available for this store`**.
- **`cartAmount`** - Items subtotal in JOD. If the promo has **`minOrderAmount`** and `cartAmount` is missing or below the minimum, the API returns **404** (promo not applicable).

**Success Response (200):**
```json
{
  "success": true,
  "message": "promocode Value is 10.0",
  "data": {
    "value": 10.0,
    "name": "SAVE10",
    "appliesToAllStores": true,
    "minOrderAmount": null
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

For a **store-specific** promo (when `appliesToAllStores` is `false`), **`data.storeId`** is the store id the code applies to. **`minOrderAmount`** is included when the admin set a floor (or `null`).

**Not Found Response (404):**
```json
{
  "success": false,
  "message": "promo code not available"
}
```

or, when `storeId` was sent and does not match:

```json
{
  "success": false,
  "message": "promo code not available for this store"
}
```

**Examples:**
```javascript
// Any store (code must exist)
const r1 = await fetch('https://arheb-backend.onrender.com/api/promo-codes/SAVE10');

// Validate for checkout at store "1"
const r2 = await fetch('https://arheb-backend.onrender.com/api/promo-codes/SAVE10?storeId=1');
const data = await r2.json();
if (data.success) {
  console.log(`Promo value: ${data.data.value}, all stores: ${data.data.appliesToAllStores}`);
}

// With minimum cart (items subtotal 25 JOD)
const r3 = await fetch(
  'https://arheb-backend.onrender.com/api/promo-codes/SAVEBIG?storeId=1&cartAmount=25',
);
```

### Admin promo codes

**Access:** SuperAdmin and Admin only.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/promo-codes` | List all promo codes (`id`, `name`, `value`, **`storeId`** (null = all stores), **`minOrderAmount`** (optional), `createdAt`). |
| POST | `/api/admin/promo-codes` | Body: **`name`**, **`value`** (number ≥ 0), optional **`storeId`** (string), optional **`minOrderAmount`** (number ≥ 0, cart subtotal floor). Omit **`storeId`** or send null for **all stores**. |
| PATCH | `/api/admin/promo-codes/:id` | Body: optional **`name`**, **`value`**, **`storeId`**, **`minOrderAmount`** (send `null` to clear the floor). Set **`storeId`** to `null` to make the code apply to all stores. |
| DELETE | `/api/admin/promo-codes/:id` | Delete promo code. |

The dashboard **Promo codes** page lets you choose **all stores** or **one store** when creating or editing a code, and set an optional **minimum cart amount**.

---

## Popup

### Get Popup

Retrieves the popup configuration (image, call-to-action button, destination type and value). Data is read from `Arheb API JSON/popup.json`.

**Endpoint:** `GET /api/popup`

**Authentication:** Not required

**Success Response (200):**
```json
{
  "success": true,
  "message": "Popup retrieved successfully",
  "data": {
    "popup": {
      "image": "",
      "call_of_action_button": "",
      "destination": "product || store || category || phone || whatsapp || url",
      "destination_value": "product_id || store_id || category_id || phone_number || whatsapp_number || url_link"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/popup');
const data = await response.json();
console.log(data.data.popup);
```

---

## Arheb Box

**Pausing new orders:** Set **`ARHEB_BOX_PAUSED=true`** (or `1` / `yes`) in the server environment. While paused, **`POST /api/arheb-box/quote`**, **`POST /api/arheb-box`**, and **`POST /api/payment/arheb-box/initiate`** respond with **503** and `code: "ARHEB_BOX_PAUSED"`. Existing requests still work (**GET** customer/admin, driver accept/complete, admin assign). Card payments that already succeeded still create the request via the payment callback (`allowWhenPaused`). Remove the variable or set it to `false` to turn Arheb Box back on.

**“Coming soon” flag (for the app UI, not hardcoded):** **`GET /api/contact`** returns **`data.arhebBox`**: `{ comingSoon, paused, acceptingNewOrders }`. **`comingSoon`** is **`true`** if **`ARHEB_BOX_COMING_SOON`** is set on the server **or** **`arhebBoxComingSoon`** is enabled in **`PATCH /api/admin/info`** (stored in **`contact_us`**). Use it to show a badge or hide entry points; it does **not** block APIs by itself (use **`ARHEB_BOX_PAUSED`** for that).

Requests are stored in `arheb_box_requests` with **sender/receiver** contacts, pickup & dropoff (lat/lng + address + `mapsUrl`), **payment** (`paymentMethod`, `whoPays`: `sender` | `receiver`), **trip amount** (`amount` in JOD), **distance** and **minimum price** (`distanceKm`, `minAmountJod`). **Arheb Box pricing is separate from store orders:** minimum parcel amount / delivery fee basis is **1 JOD for the first km + 0.5 JOD per additional km** (no cap). **`minAmountJod`** from **`POST /api/arheb-box/quote`** matches that formula. The client must call **quote** first, then send an `amount` ≥ `minAmountJod`. After a driver is assigned, **customer** `GET /api/arheb-box/:id` and list/detail responses include **`driverPhone`**. Order objects and Arheb Box rows may include **`createdAtJordan`** (human-readable **Asia/Amman** time) alongside UTC `createdAt`.

**Store vs Arheb Box (backend rules):** **Delivery fee** — store orders use configurable platform tiers (and overrides) in `src/utils/deliveryFees.js`. Arheb Box uses **1 JOD first km + 0.5 JOD per extra km, no cap** (`arhebBoxDeliveryFeeFromDistanceJod`). **Service fee** — store checkout uses the platform default or per-store override; **Arheb Box uses `serviceFee` 0** at quote and checkout (no 0.65 platform line). The **`arhebBoxServiceFeeJod`** field on App info is legacy and does not change Arheb Box pricing. **Checkout fees VAT** — store order and Arheb Box quote/checkout use **`feesTaxRate` 0** on fees. JoFotara XML tax behavior is separate (see `src/jofotara.js`). Admin unified **`GET /api/admin/orders`** uses **`totalAmount`** = cart subtotal for stores and **parcel `amount`** for Arheb Box rows; **`deliveryFee` / `serviceFee` / `feesTax` / `invoice`** on each row reflect the stored row.

### Arheb Box quote (distance, minimum amount, delivery fee & tax)

**Endpoint:** `POST /api/arheb-box/quote`  
**Authentication:** Not required

**Body:** same `pickup` / `dropoff` shape as submit (each with `latitude`, `longitude`). Optional **`weightKg`** (number, ≥ 0) for parity with submit; delivery fee is currently **distance-only** (same as create).

**Response:** `distanceKm`, `minAmountJod`, **`deliveryFee`**, **`feesTax`** (0 with current **`feesTaxRate`**), **`serviceFee`** (always **0**), **`invoice`** (`deliveryFee`, `serviceFee`, `feesTax`, `feesTaxRate`, `total`), `currency: "JOD"`, `pricingNote`. `minAmountJod` is the minimum **parcel amount** (JOD) for the route, matching the delivery-fee formula **1 + 0.5×(km−1)** (no maximum).

### Get Arheb Box request by ID (customer)

**Endpoint:** `GET /api/arheb-box/:id`  
**Authentication:** Required (owner only – same phone as sender)

Returns full request including **`driverPhone`** when a driver is assigned.

### Submit Arheb Box Request

**Endpoint:** `POST /api/arheb-box`  
**Authentication:** Required (Bearer token)

**Request Body (required fields):**
```json
{
  "pickup": { "latitude": 29.532, "longitude": 35.0063, "address": "العقبة" },
  "dropoff": { "latitude": 31.9539, "longitude": 35.9106, "address": "عمان" },
  "receiverPhone": "0791111111",
  "receiverName": "Receiver Name",
  "paymentMethod": "cash",
  "whoPays": "sender",
  "amount": 5,
  "notes": "optional",
  "fcmToken": "optional"
}
```

- **`paymentMethod`**: e.g. `cash`, `Cliq`, `card`  
- **`whoPays`**: `"sender"` or `"receiver"`  
- **`amount`**: number (JOD); must be **≥** `minAmountJod` from `POST /api/arheb-box/quote` for the same pickup/dropoff (otherwise `400` with `data.minAmountJod` and `data.distanceKm`).

**Success response** includes `paymentMethod`, `whoPays`, `amount`, `distanceKm`, `minAmountJod`, pickup/dropoff with `mapsUrl`, sender/receiver phones and names.

**Admin (dashboard):** `GET /api/admin/arheb-box`, **`GET /api/admin/arheb-box/:id`** (single request, same enriched shape as list), `PATCH /api/admin/arheb-box/:id`, `POST /api/admin/arheb-box/:id/assign-driver`, `POST /api/admin/arheb-box/:id/reassign-driver` (Admin/SuperAdmin). **SuperAdmin:** **`DELETE /api/admin/arheb-box/:id`** removes the request (and related `driver_requests` / `payment_transactions` rows). Admin/driver responses include pricing fields and **`driverPhone`** when applicable.

**Driver:** `GET /api/driver/arheb-box` includes **`amount`**, **`paymentMethod`**, **`whoPays`**, **`distanceKm`**, **`minAmountJod`**, sender/receiver phones, and maps links.

---

## Contact

### Get Contact Information

Retrieves contact information (email and phone).

**Endpoint:** `GET /api/contact`

**Authentication:** Not required

**Success Response (200):**
```json
{
  "success": true,
  "message": "Contact information retrieved successfully",
  "data": {
    "contact": {
      "email": "contact@arheb.com",
      "phone": "+201234567890",
      "cliqNumber": "",
      "driverDeliveryPercent": 0.65,
      "driverDeliveryDefaultEffective": 0.65
    },
    "arhebBox": {
      "comingSoon": false,
      "paused": false,
      "acceptingNewOrders": true
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

- **`driverDeliveryPercent`**: App-wide default **share of the delivery fee** for drivers when **`drivers.commissionPercent`** is unset (`null`–`1` or `0`–`100` style values normalized on read). Mirrors **GET/PATCH /api/admin/info**.
- **`driverDeliveryDefaultEffective`**: Resolved default after fallbacks (App info → legacy global [driver commission settings](#admin-driver-commission)).
- **`arhebBox`**: Feature flags for the mobile app — **`comingSoon`** (DB and/or env), **`paused`** (env **`ARHEB_BOX_PAUSED`** only), **`acceptingNewOrders`** (`!paused`).

---

### App version (public)

Minimum app versions for **force-update** or compatibility checks. Values are edited in the **admin dashboard → App info** (`GET/PATCH /api/admin/info` → **`appVersion`**: `{ "android", "ios" }`). Stored on the same **`contact_us`** row as contact info; the public endpoints read the **latest** row by **`updatedAt`** (then **`id`**).

**Endpoints (no authentication):**

| Method | Path | Response body |
|--------|------|----------------|
| GET | `/api/app_version` | `{ "android": "1.8.0", "ios": "3.2" }` — semver-style strings; empty string if unset |
| GET | `/app_version` | Same JSON (alias path) |

Short **`Cache-Control: public, max-age=60`** is set on these responses.

**Admin:** **`PATCH /api/admin/info`** may include **`appVersionAndroid`** and **`appVersionIos`** (or nested **`appVersion`: `{ "android"?, "ios"? }`**) to update the strings returned above.

---

### Update Contact Information (Admin)

Updates contact information. Requires admin authentication.

**Endpoint:** `PUT /api/contact`

**Authentication:** Required (Bearer token + Admin role)

**Request Body (at least one field required):**
```json
{
  "email": "newemail@arheb.com",
  "phone": "+209876543210"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Fields updated successfully: email, phone",
  "data": {
    "contact": {
      "email": "newemail@arheb.com",
      "phone": "+209876543210"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Unauthorized Response (403):**
```json
{
  "success": false,
  "message": "Error not authorized"
}
```

**Note:** To make a user admin, update the `users` table:
```sql
UPDATE users SET type = 'admin' WHERE phoneNumber = '+201500157920';
```

---

## E-Invoicing (JOFOTARA — Jordan National Electronic Invoicing)

Arheb integrates with Jordan's **JOFOTARA** system to automatically submit **Income Bills** (فاتورة دخل) to the Income and Sales Tax Department (ISTD) when orders are delivered.

### How it works

1. When an order status changes to **`Delivered`** (via admin dashboard or store admin), the backend **automatically** submits an e-invoice to JOFOTARA (unless submissions are **paused** — see below).
2. The invoice covers **delivery fee + service fee** at **7% tax** (same calculation used in checkout).
3. The submission is **asynchronous** — order status updates are never blocked by JOFOTARA API issues.
4. On success, JOFOTARA returns a **QR code** (`EINV_QR`) that is saved on the order.
5. On failure, the error is saved and the admin can **retry** via the dashboard or API.

### Pausing submissions

Submissions are **skipped** (order **`einvoiceStatus`** → **`paused`**, no HTTP call to JoFotara) when any of the following is true:

- **Environment:** **`JOFOTARA_PAUSED`** or **`EINVOICE_PAUSED`** set to **`1`**, **`true`**, or **`yes`** (case-insensitive).
- **Database:** **`einvoicePaused`** on the **latest App info** row in **`contact_us`** (row with newest **`updatedAt`**, then highest **`id`**) — toggled from the admin dashboard **App info** screen (**`PATCH /api/admin/info`**, body **`einvoicePaused`**: boolean).

This avoids mistakenly reading an older duplicate **`contact_us`** row when multiple rows exist.

### Invoice details

| Field | Value |
|-------|-------|
| Invoice type | Income Bill (فاتورة دخل), UBL type **388** |
| Tax rate | 7% on delivery fee + service fee (per line; totals = sum of lines) |
| Payment method | **`011`** (cash) or **`021`** (card / receivable) from order `paymentType` — income-invoice codes per JoFotara |
| Currency | **`DocumentCurrencyCode` / `TaxCurrencyCode`:** JOD; **monetary `currencyID` on amounts:** `JO` (Jordan e-invoice profile; matches [jafar-albadarneh/jofotara](https://github.com/jafar-albadarneh/jofotara) SDK) |
| Format | UBL 2.1 XML, base64-encoded |
| API endpoint | `https://backend.jofotara.gov.jo/core/invoices/` |

**Validation errors:** If JoFotara returns **`totalSpecialTaxesAmount`** / **`totalInclusiveAmount`** / **`totalPayableAmount`** incorrect, the XML totals or line VAT no longer match their rules (often currency code on amounts or line/document tax structure). XSD can still pass while business rules fail.

**Arheb Box retry:** **`POST /api/admin/orders/:id/einvoice/retry?type=arheb_box`** (or JSON body `{ "type": "arheb_box" }`) retries using the **`arheb_box_requests`** row id, not a store order id.

### Environment variables (set on Render)

| Variable | Description |
|----------|-------------|
| `JOFOTARA_CLIENT_ID` | Client identifier from JOFOTARA portal (رقم المستخدم) |
| `JOFOTARA_SECRET_KEY` | Secret key from JOFOTARA portal (المفتاح السري) |
| `JOFOTARA_INCOME_SOURCE` | Income source sequence number (تسلسل مصدر الدخل) |
| `JOFOTARA_SELLER_TIN` | Seller Tax ID Number (الرقم الضريبي) |
| `JOFOTARA_SELLER_NAME` | Seller company name (اسم الشركة) |
| `JOFOTARA_PAUSED` | When `1` / `true` / `yes`, pauses all JoFotara submissions (same as dashboard “Pause e-invoice”). |
| `EINVOICE_PAUSED` | Optional alias for the same pause behavior as **`JOFOTARA_PAUSED`**. |

If credentials are not configured, submissions are **skipped** (status `skipped`) and logged.

### Admin endpoints

- **`GET /api/admin/einvoices`** — List all orders with e-invoice data. Filters: `status` (`submitted`/`failed`/`pending`/`skipped`), `dateFrom`, `dateTo`. Returns `data.invoices` + `data.counts`.
- **`GET /api/admin/orders/:orderId/einvoice`** — E-invoice details for a single order.
- **`POST /api/admin/orders/:orderId/einvoice/retry`** — Retry a failed submission. For **Arheb Box**, send **`?type=arheb_box`** or body **`{ "type": "arheb_box" }`** with **`orderId`** = box request id.

All e-invoice endpoints are **Admin / SuperAdmin only**. Store admins can trigger invoice submission (by marking order Delivered) but cannot view e-invoice details.

### Dashboard

The **E-Invoices** page (sidebar, Admin/SuperAdmin only) shows:
- Summary counts: Submitted, Failed, Pending, Skipped
- Filterable table with order ID, store, customer, fees, tax, invoice status, UUID, date
- Retry button for failed/skipped invoices
- Order detail modal also shows e-invoice status badge + QR when applicable

### Order columns added

| Column | Type | Description |
|--------|------|-------------|
| `einvoiceStatus` | TEXT | `pending`, `submitted`, `failed`, `skipped` |
| `einvoiceQR` | TEXT | QR code string from JOFOTARA |
| `einvoiceUUID` | TEXT | UUID used for the invoice |
| `einvoiceError` | TEXT | Error message if failed |
| `einvoiceSubmittedAt` | TEXT | ISO timestamp of submission |

---

## Admin API

All admin endpoints require **Admin JWT** authentication unless noted. Send the token in the `Authorization` header exactly as returned by **`POST /api/admin/login`** (typically `Bearer …`). Roles: **SuperAdmin**, **Admin**, **Store Admin**. **Store Admin** is scoped to their **`storeId`** on routes that carry a store id.

### Admin API complete endpoint catalog

Single reference for every **`/api/admin/*`** route (mirrors `src/admin/routes.js`). **`A/S`** = Admin + SuperAdmin; **`SA`** = Store Admin (store-scoped); **`Sup`** = SuperAdmin only; **`Dash`** = any dashboard role (`SuperAdmin`, `Admin`, `Store Admin`). **`Auth`** = Bearer admin JWT required.

#### Session & accounts

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| POST | `/api/admin/login` | Public | Email + password → `{ token, admin }`. |
| GET | `/api/admin/me` | Auth | Current admin profile. |
| PATCH | `/api/admin/me/password` | Dash | Change own password. |
| GET | `/api/admin/activity-log` | Dash | Pagination + filters; SA sees own rows only. |

#### Admins & users (customers)

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/admins` | A/S | Admin list (Admin cannot see SuperAdmins). |
| POST | `/api/admin/admins` | A/S | Create admin / store admin. |
| PATCH | `/api/admin/admins/:id` | A/S | Update admin. |
| DELETE | `/api/admin/admins/:id` | A/S | Delete admin (rules per role). |
| GET | `/api/admin/users` | A/S | List/search users — optional order aggregates (see [GET /api/admin/users (order statistics)](#get-apiproadminusers-order-statistics)); query `q` / `search`. |
| PATCH | `/api/admin/users/:phone/block` | A/S | Block/unblock user. |
| GET | `/api/admin/users/:phone/orders` | A/S | Orders for phone. |
| GET | `/api/admin/customers/:phone/profile` | A/S | Profile + orders shortcut. |

#### Stores & catalog

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/stores` | Auth | List; SA = one store; filters `isOpen`, `paused`. |
| GET | `/api/admin/stores/pause-history` | Auth | Pause sessions; optional `storeIds`, dates. |
| POST | `/api/admin/stores` | A/S | Create store. |
| GET | `/api/admin/stores/:id` | Auth | SA must own store. |
| PATCH | `/api/admin/stores/:id` | Auth | Update store (including **`storeCategories`** — each item may include **`image`** URL for category tabs); SA blocked if store **blocked**. |
| DELETE | `/api/admin/stores/:id` | A/S | Delete store + products JSON. |
| POST | `/api/admin/stores/:id/clone` | Auth | Clone store (SA own store). |
| POST | `/api/admin/stores/bulk-checkout-policy` | A/S | Bulk checkout flags / fees. |

#### Products (per store)

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/stores/:storeId/products` | Auth | Optional `?name=` search. |
| POST | `/api/admin/stores/:storeId/products` | Auth | SA → pending queue; A/S → live. |
| PATCH | `/api/admin/stores/:storeId/products/:productId` | Auth | Update product. |
| DELETE | `/api/admin/stores/:storeId/products/:productId` | Auth | Delete product. |
| POST | `/api/admin/stores/:storeId/products/import` | Auth | Excel upload `multipart/form-data` `file`. |
| GET | `/api/admin/stores/:storeId/products/export` | Auth | Excel; optional `?categoryFilter=` (see changelog). |
| POST | `/api/admin/stores/:storeId/products/bulk-discount` | Auth | Bulk % discount. |
| POST | `/api/admin/stores/:storeId/products/bulk-remove-discount` | Auth | Clear discounts. |

#### Pending products

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/pending-products` | Auth | SA = own store pending rows. |
| GET | `/api/admin/pending-products/:id` | Auth | Detail. |
| POST | `/api/admin/pending-products/:id/approve` | A/S | Approve → live product. |
| POST | `/api/admin/pending-products/:id/reject` | A/S | Reject + optional note. |

#### Orders

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/orders/counts` | Auth | Aggregates; optional `storeIds`. |
| GET | `/api/admin/orders` | Auth | List + filters (`orderId`, dates, status, `orderType`, …). |
| GET | `/api/admin/orders/export` | Auth | Excel export (same filters). |
| GET | `/api/admin/orders/:orderId` | Auth | Detail; box: `?type=arheb_box`. |
| PATCH | `/api/admin/orders/:orderId/status` | Auth | SA = step-forward / reject rules. |
| POST | `/api/admin/orders/:orderId/reject` | Auth | Cancel when allowed. |
| DELETE | `/api/admin/orders/:orderId` | Sup | Permanent delete (first registered handler). |
| GET | `/api/admin/orders/:orderId/available-drivers` | A/S | Drivers not already pending invite. |
| GET | `/api/admin/orders/:orderId/nearby-drivers` | A/S | Online + distance to store. |
| GET | `/api/admin/orders/:orderId/assignable-drivers` | A/S | Online first, then offline. |
| POST | `/api/admin/orders/:orderId/request-driver` | A/S | Targeted FCM/socket invites. |
| POST | `/api/admin/orders/:orderId/auto-assign` | A/S | Re-run cluster assign. |
| POST | `/api/admin/orders/:orderId/assign-driver` | A/S | Manual assign → Driver to pick. |
| POST | `/api/admin/orders/:orderId/reassign-driver` | A/S | Reassign driver. |
| GET | `/api/admin/orders/:orderId/tracking` | Auth | Live tracking payload. |
| GET | `/api/admin/orders/:orderId/driver-map` | Auth | Map / driver / URLs. |

#### Notifications & dashboard

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| POST | `/api/admin/notifications/broadcast` | A/S | FCM broadcast + history row. |
| POST | `/api/admin/notifications/fcm-test` | Sup | Single-device test push. |
| GET | `/api/admin/notifications` | A/S | Broadcast history list. |
| GET | `/api/admin/dashboard/sales` | Auth | Sales aggregates (scoped for SA). |

#### Arheb Box (admin)

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/arheb-box` | Auth | List requests (SA may be limited). |
| GET | `/api/admin/arheb-box/:id` | Auth | Detail. |
| PATCH | `/api/admin/arheb-box/:id` | Auth | Status updates. |
| DELETE | `/api/admin/arheb-box/:id` | Sup | Permanent delete. |
| POST | `/api/admin/arheb-box/:id/assign-driver` | Auth | Assign driver. |
| POST | `/api/admin/arheb-box/:id/reassign-driver` | A/S | Change driver. |
| POST | `/api/admin/arheb-box/:id/request-driver` | A/S | Invite drivers / broadcast. |

#### Drivers

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/drivers` | A/S | List drivers. |
| GET | `/api/admin/drivers/export` | A/S | Excel export. |
| GET | `/api/admin/drivers/:id/profile` | A/S | Profile + deliveries + ratings. |
| POST | `/api/admin/drivers` | A/S | Create driver. |
| PATCH | `/api/admin/drivers/:id` | A/S | Update driver / block / commission. |
| DELETE | `/api/admin/drivers/:id` | A/S | Remove driver. |
| GET | `/api/admin/drivers/active-map` | A/S | Socket presence + locations. |

#### Settings & fees

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/settings/driver-commission` | A/S | Global commission defaults. |
| PATCH | `/api/admin/settings/driver-commission` | A/S | Update defaults. |
| GET | `/api/admin/settings/checkout-fees` | A/S | Platform checkout tiers. |
| PATCH | `/api/admin/settings/checkout-fees` | Sup | Update platform fees. |
| GET | `/api/admin/settings/delivery-fixed-zones` | A/S | Fixed delivery zones. |
| PUT | `/api/admin/settings/delivery-fixed-zones` | Sup | Replace zones list. |

#### Categories, popup, home, info

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/categories` | A/S | List (admin). |
| POST | `/api/admin/categories` | A/S | Create. |
| PATCH | `/api/admin/categories/:id` | A/S | Update. |
| DELETE | `/api/admin/categories/:id` | A/S | Delete. |
| GET | `/api/admin/popup` | A/S | In-app popup JSON. |
| PATCH | `/api/admin/popup` | A/S | Update popup fields. |
| DELETE | `/api/admin/popup` | A/S | Reset popup (disabled, no image/CTA/destination). |
| GET | `/api/admin/home/link-options` | A/S | Stores/categories/products for editors. |
| GET | `/api/admin/home/banners` | A/S | Read home banners. |
| PATCH | `/api/admin/home/banners` | A/S | Replace home banners. |
| GET | `/api/admin/home/offers` | A/S | Read home offers strip. |
| PATCH | `/api/admin/home/offers` | A/S | Replace home offers. |
| GET | `/api/admin/info` | A/S | Contact, versions, feature flags, driver %. |
| PATCH | `/api/admin/info` | A/S | Update same fields. |

#### Promo codes & e-invoices

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/promo-codes` | A/S | List promos. |
| POST | `/api/admin/promo-codes` | A/S | Create. |
| PATCH | `/api/admin/promo-codes/:id` | A/S | Update. |
| DELETE | `/api/admin/promo-codes/:id` | A/S | Delete. |
| GET | `/api/admin/einvoices` | A/S | Invoice list + filters. |
| GET | `/api/admin/orders/:orderId/einvoice` | A/S | Single order invoice meta. |
| POST | `/api/admin/orders/:orderId/einvoice/retry` | A/S | Retry JoFotara. |

#### Other

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| GET | `/api/admin/merchants/online` | A/S | Merchant/store-admin socket presence. |

For behaviour details (Store Admin status rules, payment methods, checkout fields), see the subsections below and [API Changelog](#api-changelog).

### Admin Dashboard HTTP usage

The **admin dashboard** (`dashboard/` Next.js app) does **not** implement a separate public REST API for catalog data. All CRUD goes to this backend:

| Environment | Base URL |
|-------------|----------|
| **Production** | `NEXT_PUBLIC_API_BASE` if set in the dashboard build; otherwise **`https://arheb-backend.onrender.com`** — see `dashboard/lib/api.js` (`getApiBase()`). |
| **Local dev** | **`/backend-api`** on the Next.js origin (rewrites to the real backend — `dashboard/next.config.js`) so the browser avoids CORS while still sending **`Authorization`**. |

**Socket.IO** (live orders list, merchant presence) uses **`getRemoteApiOrigin()`** — always the real backend host, not the `/backend-api` rewrite.

**Browser-only (not backend REST):** Firebase Storage uploads from `dashboard/lib/firebase.js` (compat SDK from `gstatic`): store **cover** / **logo**, **product** images, **home** banners & offers, **popup**, **notification** broadcast images, **store category tab** images (for configured store ids), etc. The upload returns a **download URL**; the dashboard saves it via **`PATCH /api/admin/stores/:id`**, product PATCH, **`PATCH /api/admin/home/banners`**, and related admin endpoints. Requires **`NEXT_PUBLIC_FIREBASE_*`** (and Storage rules allowing client writes).

### GET /api/admin/users (order statistics)

**Endpoint:** `GET /api/admin/users`

**Authentication:** Admin JWT (**Admin** or **SuperAdmin**).

**Query parameters:**

| Parameter | Description |
|-----------|-------------|
| **`q`** or **`search`** | Optional substring filter on **`phoneNumber`** / **`name`**. |
| **`withOrderStats`** | **`1`** / **`true`** enables aggregates; **`stats`** = **`1`** / **`true`** is an alias. |
| **`allTime`** | With stats: **`1`** / **`true`** / **`allDates=1`** counts **all** orders (no date filter). |
| **`dateFrom`**, **`dateTo`** | With stats and **without** “all time”: optional **`YYYY-MM-DD`** bounds on **`date(orders.createdAt)`** (inclusive). Either or both may be set. |
| **`limit`** | With stats: optional positive integer (max **500**). Appends **`LIMIT`** after ranking by **`orderCount`** / **`ordersGrandTotalJod`**. Omit for the full ranked list. |
| **`includeZeroOrders`** | With stats and **`limit`**: **`1`** / **`true`** keeps users with zero matching orders in the period (otherwise they are excluded via **`HAVING COUNT(o.id) > 0`**). |
| **`excludeZeroOrders`** | With stats and **no** **`limit`**: **`1`** / **`true`** drops users with zero matching orders in the period. Ignored when **`limit`** is set (unless **`includeZeroOrders`** overrides). |

**Response `data`:**

- **`users`** — array as below.
- **`meta`** — always includes **`totalRegisteredUsers`** (count of non-deleted **`users`**) and **`withOrderStats`**. When stats are on, **`meta`** also includes **`allTime`**, **`dateFrom`**, **`dateTo`**, **`limit`** (nullable), and **`excludeZeroOrders`** (whether zero-order rows were filtered).

**When `withOrderStats` is set:**

- Each user includes **`orderCount`** (matching orders) and **`ordersGrandTotalJod`** (rounded sum). Each counted order contributes **`totalAmount` + `deliveryFee` + `serviceFee` + `feesTax`** from the **`orders`** row (same idea as customer-facing payable totals: DB **`totalAmount`** is items subtotal).
- Orders match when **`orders.phoneNumber`** equals **`users.phoneNumber`** or **`orders.userId`** equals **`COALESCE(NULLIF(TRIM(users.userId),''), users.phoneNumber)`**.
- Sort order: **`orderCount`** descending, then **`ordersGrandTotalJod`** descending, then **`createdAt`** descending.

**When `withOrderStats` is omitted:** unchanged behaviour — users sorted by **`createdAt`** descending only.

---

### Admin Login

**Endpoint:** `POST /api/admin/login`

**Request Body:**
```json
{
  "email": "admin@arheb.com",
  "password": "your-password"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "token": "Bearer eyJhbGciOiJIUzI1NiIs...",
  "admin": {
    "id": 1,
    "email": "admin@arheb.com",
    "role": "SuperAdmin",
    "storeId": null,
    "name": "Admin Name"
  }
}
```

**Error Responses:** `400` (email/password required), `401` (invalid email or password).

---

### Get Current Admin (Me)

**Endpoint:** `GET /api/admin/me`

**Authentication:** Required (Admin Bearer token)

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "admin@arheb.com",
    "role": "SuperAdmin",
    "storeId": null,
    "name": "Admin Name"
  }
}
```

---

### Activity log

**Endpoint:** `GET /api/admin/activity-log`

**Access:** **SuperAdmin**, **Admin**, and **Store Admin** (dashboard roles). **Store Admin** only sees rows for **their own** `adminId`. **Admin** and **SuperAdmin** see the full log.

**Query parameters (all optional):**

| Param | Description |
|--------|-------------|
| `page` | Page number (default `1`) |
| `perPage` | Page size, max `100` (default `25`) |
| `storeId` | Filter by `storeScopeId` (Store Admin may only use their own store id) |
| `action` | `add`, `edit`, or `delete` |
| `resourceType` | Exact match, e.g. `product`, `store`, `driver`, `admin_user`, `pending_product`, `home_banner`, `app_info`, `promo_code`, … |
| `adminId` | Filter by actor (Admin/SuperAdmin only; forbidden for Store Admin) |
| `dateFrom` / `dateTo` | Inclusive date filters on `createdAt` (ISO date string) |

**Response:** `{ success, data: { activities[], page, perPage, total, totalPages } }`. Each activity includes `adminId`, `adminEmail`, `adminName`, `role`, `action`, `resourceType`, `resourceId`, `storeScopeId`, `summary`, optional `details` (parsed JSON).

Mutations across the admin API append to the `admin_activity_log` table (products, stores, drivers, admins, orders, promos, home content, app info, etc.).

---

### Order status: cancelled orders

**PATCH** `/api/admin/orders/:orderId/status`: if the order is already **cancelled**, only **SuperAdmin** may change status (including moving back to an earlier phase). Other roles receive **403** with a message explaining this. Non–SuperAdmin users also cannot apply **backward** status transitions on non-cancelled orders (same guard).

**Store Admin** (orders for their store only):

- May **reject / cancel** (**POST** `/api/admin/orders/:orderId/reject` or **PATCH** to `Cancelled`) only while status is **`Pending payment`**, **`Waiting cliq confirmation`**, or **`Waiting confirmation`**. After the order is **confirmed for preparation** (`Preparing` onward), they **cannot** cancel; they may only move status **one step forward** in the flow (e.g. `Waiting confirmation` → `Preparing`, `Preparing` → `On the way`, `On the way` → `Delivered`). Skipping steps or going backward returns **403**.
- **SuperAdmin** and **Admin** keep broader control (subject to the backward-transition and cancelled-order rules above).

**Exclusive / premium store** flags on **PATCH** `/api/admin/stores/:id`: only **SuperAdmin** and **Admin** may set **`isPremium`** / **`isExclusive`**; **Store Admin** receives **403** if they send those fields.

---

### Admins CRUD

**Access:** SuperAdmin and Admin only. Admin cannot create/edit/delete SuperAdmins.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/admins` | List all admins (Admin sees list without SuperAdmins) |
| POST | `/api/admin/admins` | Create admin (email, password, role, storeId for Store Admin, name) |
| PATCH | `/api/admin/admins/:id` | Update admin (email, password, role, storeId, name) |
| DELETE | `/api/admin/admins/:id` | Delete admin (cannot delete self or SuperAdmin unless you are SuperAdmin) |

**Roles:** `SuperAdmin`, `Admin`, `Store Admin`. For `Store Admin`, `storeId` is required.

---

### Admin Stores

Store state is derived from **admin flags + Jordan opening hours**:

- A store is **paused** when `paused === true` (never counted as open/closed).
- A store is **open** when:
  - not blocked (`blocked !== true`),
  - not paused (`paused !== true`),
  - admin did not force close (`isOpen !== false`),
  - and current time in **Jordan timezone (Asia/Amman)** is within `openingHours.open` → `openingHours.close` (or `closingTime`).
- A store is **closed** when:
  - not paused/blocked, and
  - either `isOpen === false` (explicit admin close) **or** current Jordan time is outside its opening hours.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stores` | List stores (Store Admin sees only their store). Admin/SuperAdmin query params: `isOpen=true` (only effectively open stores), `isOpen=false` (only effectively closed stores), `paused=true` (only paused stores). |
| POST | `/api/admin/stores` | Create store (Admin and SuperAdmin only). Body: name, nameEn, nameAr, cover, logo, phone, address, addressEn, deliveryFee, minimumOrder, optional **`paymentMethods`**: `{ cod, card, cliq }` booleans (at least one must be `true`). |
| GET | `/api/admin/stores/:id` | Get one store |
| PATCH | `/api/admin/stores/:id` | Update store (…, optional **`paymentMethods`**: partial `{ cod, card, cliq }` merges with existing; send **`paymentMethods`: `null`** to clear and fall back to defaults all `true`). At least one method must remain enabled. Same other fields as before: checkout overrides, **`paused`**, **`blocked`**, **`hiddenFromCustomers`**, **`isExclusive`** / **`isPremium`**, etc. |
| DELETE | `/api/admin/stores/:id` | Delete store (Admin and SuperAdmin only). Removes store and its products. |

---

### Admin Products

All under `/api/admin/stores/:storeId/products`. Store Admin can only access their store.

**Approval workflow:** When a **Store Admin** creates a product (POST), it is **not added directly** to the store. Instead, it enters a **pending approval queue**. A **SuperAdmin or Admin** must approve it before it becomes visible in the store and to users. If a **SuperAdmin or Admin** creates a product, it is added directly (no approval needed).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stores/:storeId/products` | List products for store. Query param `?name=text` to search by product name (EN/AR, case-insensitive partial match). |
| POST | `/api/admin/stores/:storeId/products` | Create product. **Store Admin**: product enters pending queue (returns `pendingId`, `status: "pending"`). **SuperAdmin/Admin**: product added directly. |
| PATCH | `/api/admin/stores/:storeId/products/:productId` | Update product |
| DELETE | `/api/admin/stores/:storeId/products/:productId` | Delete product |

---

### Admin Pending Products (Approval Queue)

When Store Admin creates a product, it enters the `pending_products` table. SuperAdmin/Admin can list, view, approve, or reject pending products.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/pending-products` | Admin | List pending products. Store Admin sees only their store's. SuperAdmin/Admin sees all. |
| GET | `/api/admin/pending-products/:id` | Admin | View pending product detail (Store Admin: own store only). |
| POST | `/api/admin/pending-products/:id/approve` | SuperAdmin/Admin | Approve: product is added to the live store products and becomes visible to users. |
| POST | `/api/admin/pending-products/:id/reject` | SuperAdmin/Admin | Reject: product stays in pending with `status: "rejected"`. Optional body: `{ "note": "reason" }`. |

**Pending product statuses:** `pending` → `approved` or `rejected`.

**Approve response:**
```json
{
  "success": true,
  "message": "Product approved and added to store",
  "data": { "product": { ... } }
}
```

**Reject response:**
```json
{
  "success": true,
  "message": "Product rejected",
  "data": { "id": 1, "status": "rejected", "note": "reason", "product": { ... } }
}
```

**Store Admin create response (pending):**
```json
{
  "success": true,
  "message": "Product submitted for approval. An admin will review it.",
  "data": { "pendingId": 1, "status": "pending", "product": { ... } }
}
```

---

### Admin Orders

Order list and order detail responses include **`driverId`** and **`driverName`** when a driver has been assigned (set when driver accepts the order; status becomes "On the way").

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/orders/counts` | Returns `{ active, complete }`: active = orders not Delivered/Cancelled; complete = Delivered or Cancelled. Store Admin: only their store. |
| GET | `/api/admin/orders` | List orders (Store Admin: only their store). Each order includes driverId, driverName when assigned. Query: `dateFrom`, `dateTo`, **`orderId`** (exact numeric id — **skips date range** when set), `status`, `orderType` (`store` \| `arheb_box`), `statusFilter` (`active` \| `complete`), `storeId`, `storeIds`, `storeName`, `name` (customer name/phone), `paymentType`, `driverId`, `unassigned`. Sorted by `createdAt DESC, id DESC`. |
| GET | `/api/admin/orders/:orderId` | Get one order with full details (items, address, notes, paymentType, storeName, driverId, driverName, etc.). Store Admin: only their store. |
| PATCH | `/api/admin/orders/:orderId/status` | Update order status. Body: `{ "status": "Preparing" }` (exact status strings as in app). **Store Admin:** only **one step forward** in the flow, or **Cancelled** only while still awaiting payment/confirmation (see Order status section). |
| DELETE | `/api/admin/orders/:orderId` | Delete order (Admin and SuperAdmin only). Removes order and its items. |

---

### Admin Dashboard Sales

**Endpoint:** `GET /api/admin/dashboard/sales`

**Authentication:** Required (Admin Bearer token). Store Admin sees only their store's orders.

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "totalOrders": 42,
    "totalRevenue": 1250.50,
    "byStatus": { "Waiting confirmation": 5, "Confirmed": 10, "Delivered": 27 },
    "openStoresCount": 12,
    "closedStoresCount": 3,
    "pausedStoresCount": 4,
    "recentOrders": [
      { "id": 1, "totalAmount": 25.5, "status": "Delivered", "createdAt": "...", "storeId": "1" }
    ]
  }
}
```

**Notes:**
- `openStoresCount`, `closedStoresCount`, and `pausedStoresCount` are returned **only for Admin and SuperAdmin** (not for Store Admin).  
- Open/closed are computed using **Jordan time (Asia/Amman)** and each store’s `openingHours` / `closingTime`:
  - Open = within hours, not blocked, not paused, and `isOpen !== false`.
  - Closed = not paused/blocked and either `isOpen === false` or outside hours.
- To list open/closed/paused stores, use the Admin Stores API:
  - `GET /api/admin/stores?isOpen=true` – effectively open stores only.
  - `GET /api/admin/stores?isOpen=false` – effectively closed stores only.
  - `GET /api/admin/stores?paused=true` – paused stores only.

---

### Admin Arheb Box

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/arheb-box` | List all Arheb box requests (id, phoneNumber, userName, pickup, dropoff, notes, status, createdAt). Sorted by `createdAt DESC, id DESC`. |
| GET | `/api/admin/arheb-box/:id` | Single request by id; **`data.request`** uses the same enrichment as list/detail (pricing, **`createdAtJordan`**, driver fields, etc.). |
| DELETE | `/api/admin/arheb-box/:id` | **SuperAdmin only.** Permanently deletes the request; cleans **`driver_requests`** where `orderId` equals this id (box driver-offer rows) and **`payment_transactions`** with **`arhebBoxRequestId`** = id. |
| PATCH | `/api/admin/arheb-box/:id` | Update request status. Body: `{ "status": "confirmed" }` (or `delivered`, `cancelled`, etc.). When status is **`delivered`**: if **e-invoice is paused** ([App info](#admin-app-info-driver-delivery-default) **`einvoicePaused`** or env **`JOFOTARA_PAUSED` / `EINVOICE_PAUSED`**), the backend does **not** call JoFotara; the row is marked with `einvoiceStatus: paused`. Otherwise JoFotara is submitted async (same as store order **PATCH** to **Delivered**). |
| POST | `/api/admin/arheb-box/:id/assign-driver` | Body `{ "driverId" }` — assigns driver, sets status **`assigned`**, notifies via FCM. |
| POST | `/api/admin/arheb-box/:id/reassign-driver` | **Admin / SuperAdmin.** Body `{ "driverId" }` — change driver on an in-flight request; **keeps** current `status` (not delivered / cancelled). FCM to old and new driver + customer. |

---

### Admin Categories

**Access:** SuperAdmin and Admin only (Store Admin cannot manage categories).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/categories` | List all categories |
| POST | `/api/admin/categories` | Create category (name, nameAr, nameEn, image, isComingSoon, order, subCategories) |
| PATCH | `/api/admin/categories/:id` | Update category |
| DELETE | `/api/admin/categories/:id` | Delete category |

---

### Admin Drivers

**Access:** SuperAdmin and Admin only (Store Admin cannot manage drivers). Drivers are created by admin only; there is no public driver registration. Blocked drivers cannot log in or access any driver data.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/drivers` | List all drivers (`id`, `name`, `mobile`, `email`, `vehicleType`, `vehicleNumber`, `licenseNumber`, `photo`, `latitude`, `longitude`, **`rating`**, **`ratingCount`**, **`commissionPercent`** (effective % after defaults), `isVerified`, `isBlocked`, `createdAt`). |
| GET | `/api/admin/drivers/export` | Download Excel (`.xlsx`) of all drivers including **`commissionPercent`**, ratings, **`createdAtJordan`**, etc. (Admin/SuperAdmin). |
| POST | `/api/admin/drivers` | Add driver. Body: `name`, `mobile` (required); `email`, `vehicleType`, `vehicleNumber`, `licenseNumber`, **`commissionPercent`** (optional, per-driver override) — No OTP. |
| PATCH | `/api/admin/drivers/:id` | Update driver and/or block. Body: any of `name`, `mobile`, `email`, `vehicleType`, `vehicleNumber`, `licenseNumber`, **`commissionPercent`**, `isBlocked` (boolean). |
| DELETE | `/api/admin/drivers/:id` | Remove driver (unassigns from orders then deletes). |

---

### Admin Driver Commission

**Access:** SuperAdmin and Admin only.

**Legacy global fallback** for how much of each order’s **delivery fee** is recorded as the driver’s **earnings** when no per-driver or App-info default applies. Default: **`percent`** with value **`0.65`**. Alternative: **`fixed`** — a flat amount in **JOD** per assigned order (capped so it never exceeds that order’s delivery fee).

**Resolution order:** **`drivers.commissionPercent`** (if set) → **[App info](#admin-app-info-driver-delivery-default)** **`driverDeliveryPercent`** → **these global settings**.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/settings/driver-commission` | Returns `{ commissionType, commissionValue, note }` — use as fallback when App info and per-driver percents are unset. |
| PATCH | `/api/admin/settings/driver-commission` | Body: `commissionType` and/or `commissionValue`. For **percent**, use a decimal **0–1** (e.g. `0.65`) or **0–100** (e.g. `65`) — both are accepted. |

On **accept** (`POST /api/driver/orders/accept`), the server snapshots **`driverCommissionType`**, **`driverCommissionValue`**, and **`driverEarnings`** on the order row so later changes to settings do not rewrite past assignments.

### Admin App Info (driver delivery default)

**Access:** SuperAdmin and Admin only.

Same backing row as public contact info, plus **default driver delivery percent** for drivers without **`commissionPercent`**.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/info` | Returns `{ email, phone, cliqNumber, driverDeliveryPercent, driverDeliveryDefaultEffective, arhebBoxComingSoon, arhebBoxServiceFeeJod, einvoicePaused, appVersion, arhebBox }`. **`appVersion`**: `{ android, ios }` strings for **`GET /api/app_version`**. **`einvoicePaused`** reflects the latest **`contact_us`** row and env (**`JOFOTARA_PAUSED`** / **`EINVOICE_PAUSED`**). |
| PATCH | `/api/admin/info` | Body: any of `email`, `phone`, `cliqNumber`, **`driverDeliveryPercent`**, **`arhebBoxComingSoon`** (boolean), **`arhebBoxServiceFeeJod`** (non-negative), **`einvoicePaused`** (boolean), **`appVersionAndroid`** / **`appVersionIos`** (or **`appVersion`**: `{ "android"?, "ios"? }`). Missing fields unchanged. When **`einvoicePaused`** is true (or env **`JOFOTARA_PAUSED` / `EINVOICE_PAUSED`**), **PATCH** store order or Arheb box to **Delivered** does **not** call JoFotara; the row is marked `einvoiceStatus: paused` instead. |

### Admin platform checkout fees

**Access:** SuperAdmin and Admin can **read**; only **SuperAdmin** can **update** (`PATCH`).

Platform-wide defaults for **store checkout** delivery (distance tiers), optional **flat** delivery fee, default **service fee**, and optional **delivery when cart ≥ threshold** (charge a fixed delivery amount when the items subtotal meets or exceeds a JOD threshold). Per-store overrides on **`PATCH /api/admin/stores/:id`** still apply (see below).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/settings/checkout-fees` | Returns `firstKmJod`, `perKmJod`, `maxJod`, `defaultServiceFeeJod`, `flatDeliveryFeeJod`, `deliveryOverCartThresholdJod`, `deliveryFeeAboveJod`, and a short **`note`**. |
| PATCH | `/api/admin/settings/checkout-fees` | **SuperAdmin.** Body: any of `firstKmJod`, `perKmJod`, `maxJod`, `defaultServiceFeeJod`, `flatDeliveryFeeJod`, `deliveryOverCartThresholdJod`, `deliveryFeeAboveJod`. **`deliveryOverCartThresholdJod`** and **`deliveryFeeAboveJod`** must be set together or both omitted (validated server-side). |

**Per-store overrides** (on **`PATCH /api/admin/stores/:id`** and bulk checkout policy): `checkoutDeliveryFeeZero`, `checkoutDeliveryFeeJod`, `checkoutServiceFeeDisabled`, `checkoutServiceFeeJod`, **`checkoutDeliveryOverCartThresholdJod`**, **`checkoutDeliveryFeeAboveJod`** (per-store cart threshold delivery; takes precedence over the platform threshold when applicable). Precedence among delivery rules is implemented in `src/utils/deliveryFees.js` (special zones and fixed overrides still win as documented in code).

### Admin Home Banners & Offers

**Access:** SuperAdmin and Admin only. Persists to the same JSON backing **`GET /api/home`** (`data.banners`, `data.offers`).

Each **banner** and **offer** object may include optional app deep-link fields (for mobile: open product, category, or store by id):

| Field | Type | Description |
|--------|------|-------------|
| `linkTarget` | `"product"` \| `"category"` \| `"store"` | Optional. When set, the client can navigate to that entity type. Invalid values are stripped. |
| `linkTargetId` | string | Optional. Product id, category id, or store id (same ids as in products / categories / stores APIs). Omitted if empty. |

These fields are **returned** on **`GET /api/home`** inside each item in **`data.banners`** and **`data.offers`**.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/home/link-options` | Returns `{ stores, categories, products }` for dashboard pickers: each row has `id` and display names (`name`, `nameAr`, `nameEn`); each **product** includes **`storeId`**. |
| GET | `/api/admin/home/banners` | Returns `{ banners }`. |
| PATCH | `/api/admin/home/banners` | Body: `{ "banners": [ ... ] }` — replaces home banners (include optional `linkTarget` / `linkTargetId` per item). |
| GET | `/api/admin/home/offers` | Returns `{ offers }` (top offers strip on home). |
| PATCH | `/api/admin/home/offers` | Body: `{ "offers": [ ... ] }` — replaces home offers (include optional `linkTarget` / `linkTargetId` per item). |

---

### Admin Driver Profile (detail)

**Access:** SuperAdmin and Admin only.

**Endpoint:** `GET /api/admin/drivers/:id/profile`

**Query parameters (all optional):**

| Param | Description |
|--------|-------------|
| `status` | Filter orders by exact DB status (e.g. `Delivered`, `On the way`). Omit or use `all` for no status filter. |
| `dateFrom` | `YYYY-MM-DD` — filter orders by `date(createdAt) >= dateFrom` |
| `dateTo` | `YYYY-MM-DD` — filter orders by `date(createdAt) <= dateTo` |
| `page`, `perPage` | Pagination for the **orders** list (default `perPage` 25) |

**Response `data` highlights:**

- **`driver`**: profile fields plus **`rating`** and **`ratingCount`** (customer driver ratings).
- **`globalCommission`**: legacy global fallback settings (same as GET `/api/admin/settings/driver-commission`); effective per-order rates use per-driver and App info as described above.
- **`stats`**: delivered / active / cancelled counts (all time, not filtered).
- **`filters`**: echo of filter + pagination metadata (`totalOrders`, etc.).
- **`earningsForFilteredDelivered`**: among **Delivered** orders matching filters — **`totalProfit`** (sum of driver earnings), **`totalDeliveryFees`**, **`orderCount`**.
- **`orders`**: each row includes **`driverShare`**: `{ commissionType, commissionValue, earningsJod }` (from snapshot or recomputed for legacy rows).
- **`ratings`**: up to 200 rows from **`driver_ratings`** (`orderId`, `userId`, `rating`, `notes`, `createdAt`) — **admin-only** visibility.

---

## Driver API

Drivers are **added, removed, and blocked only by SuperAdmin and Admin** (see [Admin API – Drivers](#admin-drivers)). There is no public driver registration. Drivers authenticate with **OTP-based login only** (Send OTP → Login with mobile + OTP). **Blocked drivers** cannot log in and cannot access any driver data (home, stats, orders, accept, complete). All protected driver endpoints require a **Driver JWT** in the `Authorization` header as `Bearer <token>`, obtained from **Driver Login**.

When a driver **accepts** an order, the backend stores a **commission snapshot** on the order and exposes it on driver-facing order payloads as **`driverShare`** (see [Driver order object (fields)](#driver-order-object-fields)). **Profit** stats use the driver’s share (**`driverEarnings`**), not the full delivery fee.

**Base path:** `/api/driver`

### Driver workflow (store & Arheb Box)

**Store orders**

1. **Pool:** `GET /api/driver/home` → **`availableOrders`**: unassigned orders in **`Preparing`**.
2. **Accept:** `POST /api/driver/orders/accept` — sets **`driverId`**, order status **`Driver to pick`**, commission snapshot. Shown in **`driverToPickOrders`** on home (no longer in **`availableOrders`**).
3. **On the way:** `POST /api/driver/orders/:orderId/on-the-way` (or `POST /api/driver/orders/on-the-way`) — status **`On the way`**. Allowed from **`Preparing`**, **`Being prepared`**, or **`Driver to pick`**.
4. **Delivered:** `POST /api/driver/orders/:orderId/complete` or **`POST /api/driver/orders/:orderId/delivered`** (or body `orderId` on `.../orders/complete` / **`.../orders/delivered`**) — status **`Delivered`** (must already be **`On the way`**).

**Admin** store order: **`POST /api/admin/orders/:orderId/assign-driver`** also sets status **`Driver to pick`**. **Reassign** allows **Preparing**, **Driver to pick**, or **On the way** ([Admin Orders](#admin-orders)).

**Arheb Box**

1. **Open jobs:** `GET /api/driver/home` → **`arhebBoxAvailable`**: only requests with **`driverId` null** (not claimed yet).
2. **Your jobs:** same response → **`arhebBoxMyActive`**: this driver’s requests in **`assigned`**, **`driver_to_pick`**, **`on_the_way`**, or legacy **`in_progress`**.  
   `GET /api/driver/orders?filter=available` also returns **`arhebBoxMyActive`** alongside **`arhebBoxAvailable`**.
3. **Accept:** `POST /api/driver/arheb-box/:id/accept` — status **`driver_to_pick`** (customer: “driver assigned”, not en route yet).
4. **On the way:** `POST /api/driver/arheb-box/:id/on-the-way` — status **`on_the_way`** (customer FCM; live map).
5. **Delivered:** `POST /api/driver/arheb-box/:id/complete` or **`POST /api/driver/arheb-box/:id/delivered`** — status **`delivered`** (requires **`on_the_way`**, or legacy **`in_progress`** for older data).

**Admin Arheb Box reassign:** `POST /api/admin/arheb-box/:id/reassign-driver` — see [Admin Arheb Box](#admin-arheb-box).

### Driver Send OTP

Sends an OTP flow identifier for driver login/register (backend returns a mock verification ID; use any OTP code for testing).

**Endpoint:** `POST /api/driver/send-otp`

**Authentication:** Not required

**Request Body:**
```json
{
  "mobile": "0790000000"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "verificationId": "driver_otp_...",
    "expiresIn": 300,
    "mobile": "0790000000"
  }
}
```

---

### Driver WhatsApp OTP

Driver login via WhatsApp uses the **same** Meta WhatsApp config as the customer flow. **Only drivers already registered** in the admin dashboard receive codes (`404` if unknown).

**Send OTP —** `POST /api/driver/whatsapp/send-otp`  
**Body:** `{ "mobile": "0790000000" }`  
**Success (200):** `{ "success": true, "data": { "verificationId", "expiresIn", "mobile", "channel": "whatsapp" } }`

**Login —** `POST /api/driver/whatsapp/login`  
**Body:** `{ "mobile": "0790000000", "otpCode": "123456", "verificationId": "<from send-otp>" }`  
**Success (200):** Same payload shape as **Driver Login** (`POST /api/driver/login`): driver profile + `Bearer` token.

---

### Driver Login

Authenticates a driver by mobile and OTP code. Returns driver profile and JWT for use in all protected driver endpoints.

**Endpoint:** `POST /api/driver/login`

**Authentication:** Not required

**Request Body:**
```json
{
  "mobile": "0790000000",
  "otpCode": "123456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "driver": {
      "id": "1",
      "name": "Ahmed Driver",
      "photo": null,
      "mobile": "0790000000",
      "email": "ahmed@example.com",
      "vehicleType": "car",
      "vehicleNumber": "ABC-123",
      "latitude": null,
      "longitude": null,
      "rating": 5,
      "isVerified": false
    },
    "token": "Bearer eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": null
  }
}
```

**Error Responses:** `401` – Driver not found (contact admin to be added); `403` – Account is blocked

---

### Driver Home

Returns the driver's home dashboard: profile, stats (**today/total profit** = driver share of delivery fees, plus delivery-fee totals), **current order** (one order mapped as actively **On the way**), **`availableOrders`** (unassigned **Preparing** store orders), **`driverToPickOrders`** (store orders you accepted — status **Driver to pick** — before you tap **on-the-way**), **`inProgressOrders`** (other **On the way** store orders if any), **`arhebBoxAvailable`** (unclaimed Arheb Box jobs only: **`driverId` is null**), and **`arhebBoxMyActive`** (Arheb Box jobs assigned to you: **`assigned`**, **`driver_to_pick`**, **`on_the_way`**, or legacy **`in_progress`**). See [Driver workflow (store & Arheb Box)](#driver-workflow-store--arheb-box).

**Endpoint:** `GET /api/driver/home`

**Authentication:** Required (Driver Bearer token)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Driver home data loaded",
  "data": {
    "driver": {
      "id": "1",
      "name": "Ahmed Driver",
      "photo": null,
      "mobile": "0790000000",
      "vehicleType": "car",
      "vehicleNumber": "ABC-123",
      "latitude": null,
      "longitude": null,
      "rating": 4.8
    },
    "stats": {
      "todayProfit": 12.5,
      "totalProfit": 340.0,
      "todayDeliveryFees": 18.0,
      "totalDeliveryFees": 520.0,
      "todayEarnings": 12.5,
      "totalEarnings": 340.0,
      "todayOrders": 8,
      "totalOrders": 245,
      "rating": 4.8
    },
    "currentOrder": null,
    "availableOrders": [
      {
        "id": "20",
        "orderNumber": "ORD-0020",
        "storeId": "1",
        "storeName": "Example Store",
        "products": [],
        "totalPrice": 50.0,
        "deliveryFee": 2.0,
        "profitJod": 1.3,
        "customerName": "Sara",
        "address": "123 Main St",
        "addressName": "Home",
        "paymentMethod": "cash",
        "status": "ready",
        "orderDate": "2024-01-15T13:00:00Z",
        "createdAt": "2024-01-15T13:00:00Z",
        "driver": null,
        "driver_latitude": null,
        "driver_longitude": null
      }
    ],
    "driverToPickOrders": [],
    "arhebBoxAvailable": [],
    "arhebBoxMyActive": [],
    "inProgressOrders": []
  }
}
```

- **`driverToPickOrders`**: store orders in status **Driver to pick** (after **accept**, before **on-the-way**). Mapped **`status`**: **`picking`**.

- **`arhebBoxAvailable`:** unclaimed open Arheb Box requests (**`driverId` null**).

- **`arhebBoxMyActive`:** your Arheb Box runs (admin-assigned, accepted, or on the way); use **`POST /api/driver/arheb-box/:id/on-the-way`** then **complete** / **delivered** per [workflow](#driver-workflow-store--arheb-box).

- **`todayProfit` / `totalProfit`**: sum of **`driverEarnings`** (or computed share) on **Delivered** orders (today vs all time).
- **`todayDeliveryFees` / `totalDeliveryFees`**: sum of **`deliveryFee`** on those same sets (informational).
- **`todayEarnings` / `totalEarnings`**: aliases for **`todayProfit` / `totalProfit`** (backward compatible).

---

### Driver Stats

Returns earnings and order stats for the driver (optionally filtered by period). **`stats.earnings`** and **`stats.profit`** are the driver’s **share** (same number). **`totalReviews`** is the driver’s **`ratingCount`**.

- **`earningsGrowthPercent`**: only when **`period=today`** — percent change in today’s driver share vs **yesterday’s** delivered orders (same driver). **`null`** if yesterday had no delivered earnings to compare, or when **`period`** is not `today`.
- **`avgDeliveryTimeMinutes`**: reserved for future use when order timing fields exist; currently always **`null`** (no placeholder).

**Endpoint:** `GET /api/driver/stats?period=today`

**Authentication:** Required (Driver Bearer token)

**Query Parameters:** `period` (optional) – `today` (default) or `all` (all orders for this driver).

**Success Response (200):**
```json
{
  "success": true,
  "message": "Stats loaded successfully",
  "data": {
    "period": "today",
    "stats": {
      "profit": 12.5,
      "earnings": 12.5,
      "earningsGrowthPercent": 8.2,
      "totalOrders": 8,
      "completedOrders": 7,
      "cancelledOrders": 1,
      "avgDeliveryTimeMinutes": null,
      "rating": 4.8,
      "totalReviews": 42
    }
  }
}
```

---

### Driver Orders List

Returns a paginated list of orders for the driver. Filter: **`all`** (everything assigned to this driver — see below), **`available`** (unassigned **store** orders in `Preparing`), or **`mine`** / **`in_progress`** (assigned store orders not yet delivered/cancelled). When **`filter=available`**, the response also includes **`arhebBoxAvailable`**, **`arhebBoxAvailableCount`**, and **`arhebBoxMyActive`**: [same split as home](#driver-home) — unclaimed box jobs vs your active box runs.

For **`filter=all`**, **`orders`** is a **merged** list of **store** orders and **Arheb Box** requests that have this **`driverId`**, sorted by **`createdAt`** descending (newest first). Each element includes **`orderType`**: **`"store"`** (same fields as [Driver order object](#driver-order-object-fields)) or **`"arheb_box"`** with a **`request`** object (enriched box payload, same shape as elsewhere in the driver API).

**Endpoint:** `GET /api/driver/orders?filter=all&page=1&perPage=20`

**Authentication:** Required (Driver Bearer token)

**Query Parameters:**
- `filter` (optional) – `all` | `available` | `mine` (default: `all`)
- `page` (optional) – page number (default: 1)
- `perPage` (optional) – items per page (default: 20, max 50)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Orders loaded successfully",
  "data": {
    "filter": "all",
    "page": 1,
    "perPage": 20,
    "total": 125,
    "orders": [
      {
        "orderType": "store",
        "id": "20",
        "orderNumber": "ORD-0020",
        "storeId": "1",
        "storeName": "Example Store",
        "totalPrice": 50.0,
        "deliveryFee": 2.0,
        "profitJod": 1.3,
        "customerName": "Sara",
        "address": "123 Main St",
        "status": "delivered",
        "orderDate": "2024-01-10T12:00:00Z",
        "createdAt": "2024-01-10T12:00:00Z",
        "driver": { "id": "1", "name": "Ahmed Driver", "mobile": "0790000000", "rating": 4.8 },
        "driver_latitude": 29.532,
        "driver_longitude": 35.0063,
        "driverShare": {
          "commissionType": "percent",
          "commissionValue": 0.65,
          "earningsJod": 1.3
        }
      },
      {
        "orderType": "arheb_box",
        "request": { "id": "15", "status": "in_progress", "deliveryFee": 3.0 }
      }
    ]
  }
}
```

Store rows include **`orderType": "store"`** plus the usual fields. **`driverShare`** is present when commission is resolved. **`filter=available`** and **`filter=in_progress`** list items are **store orders** (no **`orderType`** on those items), except **`filter=available`** also returns **`arhebBoxAvailable`** and **`arhebBoxMyActive`**. See [Driver order object (fields)](#driver-order-object-fields).

---

### Driver Order Detail

Returns full details for a single order. Driver can only access orders that are unassigned or assigned to them.

Every driver order object includes **store**, **customer**, **delivery fee**, **driver profit**, and **timestamps** for the order-details screen — see [Driver order object (fields)](#driver-order-object-fields).

**Endpoint:** `GET /api/driver/orders/:orderId`

**Authentication:** Required (Driver Bearer token)

**Path Parameters:** `orderId` – Order ID

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order loaded successfully",
  "data": {
    "order": {
      "id": "20",
      "orderNumber": "ORD-0020",
      "storeId": "1",
      "storeName": "Example Store",
      "storeAddress": "Amman",
      "storeMapsUrl": "https://...",
      "products": [...],
      "totalPrice": 50.0,
      "deliveryFee": 2.0,
      "profitJod": 1.3,
      "address": "123 Main St",
      "addressName": "Home",
      "paymentMethod": "cash",
      "status": "delivering",
      "orderDate": "2024-01-10T12:00:00Z",
      "createdAt": "2024-01-10T12:00:00Z",
      "customerName": "Sara",
      "customerPhone": "+962790000000",
      "notes": "Leave at the door",
      "driver": { "id": "1", "name": "Ahmed Driver", "mobile": "0790000000", "latitude": 29.532, "longitude": 35.0063, "rating": 4.8 },
      "driver_latitude": 29.532,
      "driver_longitude": 35.0063,
      "driverShare": {
        "commissionType": "percent",
        "commissionValue": 0.65,
        "earningsJod": 1.3
      }
    }
  }
}
```

**Error Responses:** `403` – Access denied (order assigned to another driver), `404` – Order not found

---

### Driver Accept Order

Assigns a **store** order to the authenticated driver and sets order status to **`Driver to pick`**. Persists **commission snapshot** fields on the order (`driverCommissionType`, `driverCommissionValue`, `driverEarnings`) using the effective driver rate: **per-driver `commissionPercent`** → [App info](#admin-app-info-driver-delivery-default) **`driverDeliveryPercent`** → [legacy global](#admin-driver-commission) settings. To move to **On the way**, use [Driver Mark Order On the Way](#driver-mark-order-on-the-way) (allowed from **Driver to pick** or **Preparing** / **Being prepared**).

**Endpoint:** `POST /api/driver/orders/accept`

**Authentication:** Required (Driver Bearer token)

**Request Body:**
```json
{
  "orderId": "1",
  "driverId": "1"
}
```

`driverId` is optional; if omitted, the authenticated driver's ID is used. You can only accept for yourself.

**When `driverId` is not added (accept request):** If the JSON body does **not** include **`driverId`**, the backend assigns the order to the driver identified by the **Bearer token** (same as sending your own id explicitly). If **`driverId`** is present, it must match that token’s driver or the response is **`403`**.

**When `driverId` is not on the order (responses):** In **GET** checkout orders, **GET** `/api/orders/:orderId`, **GET** `/api/admin/orders`, and driver order payloads, **`driverId`** and **`driverName`** are **`null`** (or absent) until a driver has **accepted** the order. While status is **Preparing** and no driver has accepted yet—**including** when drivers are only being invited via auto-assign / `driver_requests`—there is **no** assigned driver on the order, so **`driverId`** remains unset.

**Effect:** **`driverId`** and **`driverName`** are set; **`status`** becomes **`Driver to pick`**. The order is listed under **`driverToPickOrders`** on [Driver Home](#driver-home) until you call **on-the-way**.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order accepted successfully",
  "data": {
    "order": {
      "id": "20",
      "orderNumber": "ORD-0020",
      "totalPrice": 50.0,
      "status": "delivering",
      "driver": { "id": "1", "name": "Ahmed Driver", "mobile": "0790000000", "rating": 4.8 },
      "driver_latitude": 29.532,
      "driver_longitude": 35.0063
    }
  }
}
```

**Error Responses:** `400` – Order already assigned, `403` – Can only accept for yourself, `404` – Order not found

---

### Driver Mark Order On the Way

Sets a **store** order’s status to **`On the way`** when the **Bearer** driver is the one **assigned** to that order (**`order.driverId`** matches the token). Allowed from **`Preparing`**, **`Being prepared`**, or **`Driver to pick`**. Resets **`nearArrivalNotified`**, emits tracking/socket updates, and sends the customer an **“On the way”** FCM (same idea as admin status change).

**Authentication:** Required — **`Authorization: Bearer <driver JWT>`** (same as other driver endpoints). The **order id** is not secret; the token must match the assigned driver.

**Endpoints (choose one):**

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/driver/orders/:orderId/on-the-way` | Order id in the URL |
| POST | `/api/driver/orders/on-the-way` | Body: `{ "orderId": 123 }` (also accepts **`order_id`**) or query **`?orderId=123`** |

**Success (200):** `{ "success": true, "message": "Order marked as on the way", "data": { "order": { ... } } }`  
If the order is **already** **On the way**, **`200`** with message **`Order is already on the way`**.

**Error responses:** **`403`** — order not assigned to this driver; **`400`** — wrong prior status (e.g. still waiting confirmation) or terminal status (**Delivered** / **Cancelled**); **`404`** — order not found.

---

### Driver Complete Order

Marks a **store order** as **Delivered**. The **Bearer token** identifies the driver; the server checks that this driver is assigned to the order. Order status must be **On the way** (after accept). Idempotent: if already **Delivered**, returns success with the same message variant.

**Endpoints (choose one):**

| Method | Path | Body |
|--------|------|------|
| POST | `/api/driver/orders/:orderId/complete` | Optional: `{ "deliveryProofImage": "https://..." }` |
| POST | `/api/driver/orders/:orderId/delivered` | Same as **`complete`** (alias). |
| POST | `/api/driver/orders/complete` | `{ "orderId": 20, "deliveryProofImage": "https://..." }` |
| POST | `/api/driver/orders/delivered` | Same as **`/complete`** with body **`orderId`** (alias). |

**Authentication:** Required (**Driver** `Authorization: Bearer <token>`)

**Request Body** (only for `/complete`): `orderId` (number or string). Optional `driverId` must match the token user or request is `403`.  
Optional `deliveryProofImage` (string URL) is saved on the order and returned in order details for admin/store dashboard.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order marked as delivered successfully",
  "data": {
    "order": {
      "id": "20",
      "orderNumber": "ORD-0020",
      "status": "delivered",
      "driver": { "id": "1", "name": "Ahmed Driver" }
    }
  }
}
```

**Error Responses:** `400` – Missing `orderId` or order not **On the way** yet; `403` – Token driver ≠ assigned driver; `404` – Order not found

---

### Driver Mark Arheb Box On the Way

Moves an **Arheb Box** request to **`on_the_way`** after you have accepted it (**`driver_to_pick`**, **`assigned`**, or legacy **`in_progress`**). Sends the customer an **on the way** FCM and enables the usual live-tracking behavior. See [Driver workflow](#driver-workflow-store--arheb-box).

**Endpoint:** `POST /api/driver/arheb-box/:id/on-the-way`

**Authentication:** Required (Driver Bearer token)

**Success (200):** `{ "success": true, "message": "Arheb Box marked as on the way", "data": { "request": { ... } } }`  
If already **`on_the_way`**, **`200`** with **`Already on the way`**.

**Errors:** `400` – wrong status; `403` – not your request; `404` – not found.

---

### Driver Complete Arheb Box (delivery)

Marks an **Arheb Box** request **delivered**. **Bearer** must be the assigned driver. Status must be **`on_the_way`** (or legacy **`in_progress`**). Triggers JoFotara async when e-invoice is not paused (same rules as admin **PATCH**). Sends FCM to the customer.

**Endpoints (aliases):**

| Method | Path |
|--------|------|
| POST | `/api/driver/arheb-box/:id/complete` |
| POST | `/api/driver/arheb-box/:id/delivered` |

**Authentication:** Required (Driver Bearer token)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Arheb Box marked as delivered successfully",
  "data": { "request": { "id": 1, "status": "delivered", "...": "..." } }
}
```

**Error Responses:** `400` – Not **`on_the_way`** / legacy **`in_progress`** yet; `403` – Request not assigned to this driver; `404` – Request not found. Already **delivered** → `200` with message that it was already complete.

---

### Driver order object (fields)

For **`GET /api/driver/orders?filter=all`** and **`GET /api/driver/orders/assigned`**, each **`orders[]`** item has **`orderType`**: **`store`** | **`arheb_box`**. **Store** rows match the shape below; **Arheb Box** rows are **`{ "orderType": "arheb_box", "request": { ... } }`** (enriched box object).

On other driver endpoints (`GET /api/driver/home`, **`filter=available`** / **`in_progress`** lists, `GET /api/driver/orders/:orderId`, accept/complete responses, …), **store** orders use this shape (no **`orderType`** on **`available`** / **`in_progress`** list items):

| Field | Description |
|--------|-------------|
| **`storeId`** | Store id as string, or `null` if missing. |
| **`storeName`** | Resolved from stores listing (`nameEn` / `name` / `nameAr`), or **`null`** if the store is not found in the catalog. |
| **`storeAddress`**, **`storeMapsUrl`** | Optional store fields when the store is known; otherwise `null`. |
| **`customerName`** | Customer display name from the order. |
| **`customerPhone`** | Customer phone on the order. |
| **`deliveryFee`** | Delivery fee for the order (**JOD**, 2 decimal places). |
| **`profitJod`** | Driver’s earnings for this order (**JOD**) — duplicate of **`driverShare.earningsJod`** for convenience in the UI (`null` only if commission could not be resolved). |
| **`orderDate`**, **`createdAt`** | Order creation time (same value; ISO string from DB). |
| **`driverShare`** | Commission breakdown (see below). |

**Commission object `driverShare`:**

```json
"driverShare": {
  "commissionType": "percent",
  "commissionValue": 0.65,
  "earningsJod": 1.3
}
```

- **`commissionType`**: `"percent"` (share of `deliveryFee`) or `"fixed"` (flat JOD per order).
- **`commissionValue`**: For percent, **0–1** (e.g. `0.65` = 65%). For fixed, amount in **JOD**.
- **`earningsJod`**: Driver’s earnings for that order (snapshot at accept when columns are set; otherwise computed from current global settings for legacy rows).

---

### Driver Assigned Orders

Explicit list of **all work assigned to this driver**: **store** orders and **Arheb Box** requests with this **`driverId`**, merged by **`createdAt`** descending — same rules and **`orderType`** discrimination as **`GET /api/driver/orders?filter=all`**.

**Endpoint:** `GET /api/driver/orders/assigned?page=1&perPage=20`

**Authentication:** Required (Driver Bearer token)

**Query:** `page`, `perPage` (same limits as main orders list). Response has no **`commissionPercent`** (unlike **`GET /api/driver/orders`**); use the main orders endpoint or home if you need it.

---

### Driver Earnings (Today & Summary)

**Today (delivered orders created today):**

**Endpoint:** `GET /api/driver/earnings/today`

**Response `data`:** `date`, `orderCount`, `totalDeliveryFees`, **`totalProfit`** (sum of driver earnings).

**Range summary (delivered only, optional filter by assignment date):**

**Endpoint:** `GET /api/driver/earnings/summary?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

Both `dateFrom` and `dateTo` are optional (inclusive on `date(createdAt)`).

**Response `data`:** `dateFrom`, `dateTo`, `orderCount`, `totalDeliveryFees`, **`totalProfit`**.

---

### Driver API Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/driver/send-otp` | No | Send OTP (mock; returns verificationId) |
| POST | `/api/driver/login` | No | Login with mobile + otpCode; returns driver + token (blocked drivers get 403) |
| GET | `/api/driver/home` | Yes | Driver dashboard (blocked drivers get 403) |
| GET | `/api/driver/stats` | Yes | Stats (profit/earnings, orders, period, rating reviews count) |
| GET | `/api/driver/orders` | Yes | List orders (filter, page, perPage) |
| GET | `/api/driver/orders/assigned` | Yes | All assigned orders (paginated) |
| GET | `/api/driver/earnings/today` | Yes | Today delivered: profit + delivery fee totals |
| GET | `/api/driver/earnings/summary` | Yes | Delivered in date range: profit + delivery fee totals |
| GET | `/api/driver/orders/:orderId` | Yes | Order detail |
| POST | `/api/driver/orders/accept` | Yes | Accept order (assign to driver; status usually stays Preparing) |
| POST | `/api/driver/orders/:orderId/on-the-way` | Yes | Set status On the way (assigned driver only; from Preparing / Being prepared) |
| POST | `/api/driver/orders/on-the-way` | Yes | Same; body `{ "orderId" }` or query `orderId` |
| POST | `/api/driver/orders/:orderId/complete` | Yes | Mark store order delivered (Bearer verifies driver) |
| POST | `/api/driver/orders/complete` | Yes | Same; body `{ orderId }` |
| POST | `/api/driver/arheb-box/:id/complete` | Yes | Mark Arheb Box delivered (after accept) |

**Note:** Drivers are created only via Admin API (SuperAdmin/Admin). Blocked drivers receive `403 Account is blocked` on login and on all authenticated driver endpoints.

---

## Error Handling

All endpoints return appropriate HTTP status codes:

| Status Code | Description |
|------------|-------------|
| `200` | Success |
| `201` | Created (order created) |
| `400` | Bad Request (missing/invalid parameters) |
| `401` | Unauthorized (missing/invalid token) |
| `403` | Forbidden (access denied / not admin) |
| `404` | Not Found (resource doesn't exist) |
| `500` | Internal Server Error |

Error responses typically include a `message` field with details.

**Example Error Response:**
```json
{
  "success": false,
  "message": "Error description"
}
```

---

## Testing

A comprehensive test client is available at:

**Test Client:** `https://arheb-backend.onrender.com/test-client/index.html`

This interactive interface allows you to:
- ✅ Test authentication flow (register, verify OTP, delete user)
- ✅ **WhatsApp OTP:** customer **`POST /api/auth/whatsapp/send-code`** + **`verify-code`**; driver **`POST /api/driver/whatsapp/send-otp`** + **`login`** (requires WhatsApp env on server)
- ✅ **Admin REST catalog:** all **`/api/admin/*`** routes are listed under [Admin API complete endpoint catalog](#admin-api-complete-endpoint-catalog) in this README.
- ✅ Browse all data endpoints (categories, products, stores, home)
- ✅ Search stores and products (GET /api/search?q=text)
- ✅ Test home with optional auth (activeOrder when user has order in Waiting confirmation / Being prepared / On the way)
- ✅ Test profile management
- ✅ Create and manage orders
- ✅ Test real-time order tracking (WebSocket) with map visualization
- ✅ Validate promo codes
- ✅ **Driver API**: Send OTP, Login (token stored), Home, Stats, Orders list/detail/assigned, Earnings today/summary, Accept order, Complete order. **Admin**: List/Add/Block/Remove drivers, driver commission settings, driver profile (filters + ratings).
- ✅ **Customer**: Rate driver **POST /api/orders/:orderId/rate-driver** (after delivery).
- ✅ **Admin**: Order counts (optional storeIds), Reject order (cancel when Waiting confirmation), Pause history (date range + optional storeIds), List notifications (broadcast history).
- ✅ Test contact endpoints (admin)

---

## Authentication Flow

Complete authentication flow example:

```javascript
// Step 1: Send OTP
const registerResponse = await fetch('https://arheb-backend.onrender.com/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phoneNumber: '+201500157920' })
});
const registerData = await registerResponse.json();
const sessionInfo = registerData.sessionInfo;

// Step 2: Verify OTP
const verifyResponse = await fetch('https://arheb-backend.onrender.com/api/auth/verify-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phoneNumber: '+201500157920',
    sessionInfo: sessionInfo,
    otp: '111111'
  })
});
const verifyData = await verifyResponse.json();
const authToken = verifyData.token; // Bearer token

// Step 3: Use token for authenticated requests
const profileResponse = await fetch('https://arheb-backend.onrender.com/api/profile', {
  method: 'GET',
  headers: { 'Authorization': authToken }
});
```

---

## Notes

- 📱 Phone numbers should be in **E.164 format** (e.g., `+201500157920`)
- 🔑 JWT tokens expire after **7 days**
- ⏰ All timestamps are in **ISO 8601 format** (UTC). Many order and Arheb Box payloads also include **`createdAtJordan`** (or similar `*Jordan` fields) for display in **Jordan (Asia/Amman)** local time.
- 🔥 Backend uses **Firebase Authentication** for phone number verification
- 📦 Data endpoints return cached/static data from JSON files
- ⭐ Store ratings are calculated dynamically when orders are rated
- 💰 Promo codes automatically apply discount when used in checkout
- 👨‍💼 Admin users have access to contact management endpoints
- 🚚 Real-time order tracking uses WebSocket (Socket.IO) for live location updates
- 📍 Drivers send location updates every 3 seconds, customers receive updates in real-time
- 🚗 **Driver API** uses separate JWT (from `/api/driver/login`). Only SuperAdmin/Admin add, remove, or block drivers; blocked drivers cannot access data.

---

## Support

For issues or questions, please contact: `contact@arheb.app`

---

## API Changelog

**Last updated: 2026-04-23**

### 2026-04 — Store browse, exclusive route, delivery fees, driver %, Jordan time

- **Stores:** Public listings include **`status`**, **`isExclusive`** / **`isPremium`**; **`GET /api/stores/exclusive`** documents the curated exclusive/premium list (alias: **`/api/stores/premium`**). **`hiddenFromCustomers`** removes a store from browse without blocking it.
- **Checkout quote:** **`POST /api/checkout/quote-fees`** uses **store** delivery only: **1 JOD first km + 0.1 JOD per extra km, max 3 JOD**; tax **7% × (delivery + service fee)**; **`deliveryFeeMaxJod`** in response.
- **Arheb Box:** Quote / minimum amount uses **1 JOD first km + 0.5 JOD per extra km, no cap** (different from store orders). **`GET /api/admin/arheb-box/:id`** for dashboard detail.
- **Drivers:** **`commissionPercent`** on driver rows; **`GET /api/admin/drivers/export`**; **`GET /api/admin/drivers/active-map`** includes **`currentStoreOrderId`** and **`currentArhebBoxRequestId`** per driver.
- **App info:** **`GET/PATCH /api/admin/info`** includes **`driverDeliveryPercent`**, **`driverDeliveryDefaultEffective`**, **`arhebBoxComingSoon`**, and **`arhebBox`** (effective flags); **`GET /api/contact`** exposes contact fields and **`arhebBox`** for clients.
- **Home admin:** **`GET/PATCH /api/admin/home/offers`** (and existing banners endpoints) edit **`GET /api/home`** `offers` / `banners`.
- **Timestamps:** Orders and related payloads often include **`createdAtJordan`** (**Asia/Amman**) for display.

### New APIs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/stores/:id/payment-methods` | None | `{ storeId, paymentMethods: { cod, card, cliq } }` for checkout UI. |
| POST | `/api/checkout/quote-fees` | User (Bearer) | Pre-checkout quote: `storeId`, `deliveryLocation`, optional `weightKg`, optional **`cartAmount`** (items subtotal for cart-threshold delivery). Returns delivery/service, **`feesTaxRate` 0**, `distanceKm`, platform cap, `pricingNote`. |
| GET | `/api/admin/settings/checkout-fees` | Admin / SuperAdmin | Platform checkout tiers, flat delivery, cart-threshold delivery fields, default service fee. |
| PATCH | `/api/admin/settings/checkout-fees` | **SuperAdmin** | Update platform checkout fees (see [Admin platform checkout fees](#admin-platform-checkout-fees)). |
| GET | `/api/stores/exclusive` | None | Same as `/api/stores/premium` — exclusive/premium stores; optional `limit`. |
| GET | `/api/admin/drivers/active-map` | Admin / SuperAdmin | Returns drivers on **`/driver-presence`** (non-stale): `{ city, center, activeDriversCount, driversWithLocationCount, drivers[] }`. Each driver includes `hasLocation`, `latitude`, `longitude` (null until the app emits `location`), `lastSeen`, **`currentStoreOrderId`** (latest), **`currentStoreOrderIds`** (up to 25 active store orders), **`currentArhebBoxRequestId`**. |
| GET | `/api/admin/drivers/export` | Admin / SuperAdmin | Excel export of drivers (includes **`commissionPercent`**, **`createdAtJordan`**, etc.). |
| GET | `/api/admin/arheb-box/:id` | Admin | Single Arheb Box request (`data.request`), enriched like list. |
| GET | `/api/admin/home/link-options` | Admin / SuperAdmin | `{ stores, categories, products }` for dashboard deep-link pickers (`products[].storeId`). |
| GET | `/api/admin/home/banners` | Admin / SuperAdmin | Read `data.banners` for **`GET /api/home`**. |
| PATCH | `/api/admin/home/banners` | Admin / SuperAdmin | Replace home banners: body `{ "banners": [...] }`. |
| GET | `/api/admin/home/offers` | Admin / SuperAdmin | Read `data.offers` for **`GET /api/home`**. |
| PATCH | `/api/admin/home/offers` | Admin / SuperAdmin | Replace home offers: body `{ "offers": [...] }`. |
| GET | `/api/admin/orders/:orderId/available-drivers` | Admin (Store Admin: own store orders only) | Returns non-blocked drivers that do not already have a pending request for this order. |
| GET | `/api/admin/orders/:orderId/assignable-drivers` | Admin / SuperAdmin | All non-blocked drivers: **online** (socket presence) first, sorted by **distance to store**, then offline. Each row includes `online`, `distanceKm`, `latitude`/`longitude` when online. |
| POST | `/api/admin/orders/:orderId/request-driver` | **Admin / SuperAdmin only** | Sends a delivery request to one or more specific drivers. Body: `{ "driverIds": [1, 2, 3] }`. **Store Admin** (or `{ "all": true }` for Admin/SuperAdmin) uses **broadcast**: FCM to every online driver. Use that only when you intentionally want all drivers pinged; when an order becomes **Preparing** without a driver, the server offers **one** nearest online driver (FCM + socket); if that driver rejects, the next nearest is offered until one accepts or none remain. |
| POST | `/api/driver/orders/:orderId/reject-request` | Driver | **Disabled** — returns **403** (automatic assignment; drivers cannot reject). |
| GET | `/api/admin/orders/:orderId/driver-map` | Admin (Store Admin: own store orders only) | **Track** payload: `deliveryLocation`, `storeLocation`, `storeName`, assigned **`driver`** (id, name, mobile, vehicle, photo, **`liveLocation`**), `tracking`, **`mapPreviewUrl`**, `driverAssignmentStatus`, `driverSearchStartedAt`. |
| GET | `/api/admin/orders/:orderId/tracking` | Admin (Store Admin: own store orders only) | **Store:** path id = `orders.id`. **Arheb Box:** same path param but add **`?type=arheb_box`** and use the box request id; response includes `requestId`, `orderType: 'arheb_box'`, `lastLocation`, etc. Used with Socket.IO (`auth`: `orderId` + `trackingType: 'arheb_box'` or `requestId`). |
| GET | `/api/driver/requests` | Driver | Returns pending delivery requests for the authenticated driver. Each request includes full order payload (store name/address/mapsUrl, client address, total, delivery fee, item count, etc.). Driver accepts via existing `POST /api/driver/orders/accept`. |
| GET | `/api/admin/info` | Admin / SuperAdmin | Contact info, **`appVersion`**, **`arhebBoxServiceFeeJod`**, **`einvoicePaused`**, **`arhebBox`** flags, driver default percent fields. |
| PATCH | `/api/admin/info` | Admin / SuperAdmin | Body: any subset of `{ email, phone, cliqNumber, driverDeliveryPercent, arhebBoxComingSoon, arhebBoxServiceFeeJod, einvoicePaused, appVersionAndroid, appVersionIos, appVersion }`. |
| GET | `/api/app_version` | None | `{ "android", "ios" }` — minimum app versions from App info (`Cache-Control: public, max-age=60`). |
| GET | `/app_version` | None | Same JSON (alias path). |
| POST | `/api/driver/orders/:orderId/on-the-way` | Driver | **Preparing** / **Being prepared** / **Driver to pick** → **On the way**; assigned driver only (`Bearer` must match **`order.driverId`**). |
| POST | `/api/driver/orders/on-the-way` | Driver | Same; JSON `{ "orderId" }` or query **`?orderId=`**. |
| POST | `/api/admin/orders/:orderId/assign-driver` | Admin / SuperAdmin | Body `{ "driverId" }`. Sets **Driver to pick** (when order is **Preparing**). |
| POST | `/api/admin/orders/:orderId/reassign-driver` | Admin / SuperAdmin | Body `{ "driverId" }`. Reassign when status is **Preparing**, **Driver to pick**, or **On the way**. |
| POST | `/api/driver/orders/:orderId/delivered` | Driver | Alias of **complete** (mark store order **Delivered**). |
| POST | `/api/driver/arheb-box/:id/on-the-way` | Driver | Arheb Box → **`on_the_way`** (after accept). |
| POST | `/api/driver/arheb-box/:id/delivered` | Driver | Alias of **`/complete`** (mark box **delivered**). |
| POST | `/api/admin/stores/:storeId/products/import` | Admin / SuperAdmin / Store Admin (per-store) | Imports products for a store from an Excel file. Expects `multipart/form-data` with field `file` (`.xlsx`/`.xls`). Store Admin rows go to the pending products queue; Admin/SuperAdmin rows are imported directly. Rows with an `id` column that already exists for the store are **skipped** (no duplicate). Export includes `id` column. |
| GET | `/api/admin/stores/:storeId/products/export` | Admin / SuperAdmin / Store Admin (per-store) | Exports products as Excel (`id`, `nameEn`, `nameAr`, `price`, …). Without **`categoryFilter`**, exports **all** products for the store. With **`categoryFilter`** (same lowercase string as the dashboard category chip — matched against `category` / `categoryEn` / `categoryAr`), exports **only that category**. |
| POST | `/api/admin/orders/:orderId/reject` | Admin / SuperAdmin / Store Admin (own store) | **Store Admin:** cancel only while **`Pending payment`**, **`Waiting cliq confirmation`**, or **`Waiting confirmation`**. **Admin/SuperAdmin:** same pre-confirmation rule as before (pending / waiting / cliq). Sets status to `Cancelled`. |
| GET | `/api/admin/stores/pause-history` | Admin | Returns store pause history: sessions (pausedAt, unpausedAt, durationMinutes) and total duration. Query: `dateFrom`, `dateTo` (default today), optional `storeIds` (comma-separated). Store Admin sees only their store. |
| GET | `/api/admin/notifications` | Admin / SuperAdmin | Returns list of sent broadcast notifications (id, title, body, imageUrl, successCount, failureCount, createdAt) for the dashboard history. |
| POST | `/api/admin/notifications/broadcast` | Admin / SuperAdmin | Sends FCM to all users. Body: `{ title, body, imageUrl? }`. Each broadcast is **saved** to the `Notifications` table for later retrieval via GET `/api/admin/notifications`. |
| POST | `/api/admin/notifications/fcm-test` | **SuperAdmin only** | Sends one FCM to a device token. Body: `{ fcmToken, title, body?, imageUrl? }`. Data payload includes `type: admin_fcm_test`. Does **not** write to `user_notifications` or the broadcast history table. Returns `{ messageId }` on success. |
| GET | `/api/profile/notifications` | User (Bearer) | In-app notification inbox: paginated list (`page`, `perPage`) of notifications **sent to this user only**. Persisted in `user_notifications` when FCM is sent (per-user pushes and broadcast). Each item includes `data` (FCM payload: `orderId`, `deepLink`, `type`, …). |
| POST | `/api/payment/initiate` | User (Bearer) | Creates order from **`checkout`** body (card only), then Madfoat session. Returns **201** with `data.checkout` (same shape as POST /api/checkout) and `data.payment` (`tranRef`, `redirectUrl`, etc.). Saves `paymentTranRef` / `paymentCartId` on the order. |
| GET | `/api/payment/client-key` | None | Returns client key and profile ID for managed-form (paylib.js) frontend integration. |
| GET | `/api/payment/query/:tranRef` | User (Bearer) | Query transaction status from Madfoat by transaction reference. |
| POST | `/api/payment/refund` | User (Bearer) | Full or partial refund of a completed transaction. Body: `{ tranRef, amount?, description? }`. |
| GET | `/api/payment/transactions` | User (Bearer) | List payment transactions with optional filters (`orderId`, `status`, `page`, `perPage`). |
| POST | `/api/payment/callback` | None (Madfoat server-to-server) | Receives payment result from Madfoat after hosted page completion. Verifies HMAC signature. Not called by client. |
| GET | `/api/payment/return` | None (browser redirect) | Browser landing page after payment. Shows HTML success/failure. |
| GET | `/api/admin/einvoices` | Admin / SuperAdmin | List all orders with e-invoice data. Optional query: `status` (`submitted`/`failed`/`pending`/`skipped`), `dateFrom`, `dateTo`. Returns `data.invoices` array + `data.counts`. |
| GET | `/api/admin/orders/:orderId/einvoice` | Admin / SuperAdmin | Returns e-invoice details for a specific order: `einvoiceStatus`, `einvoiceQR`, `einvoiceUUID`, `einvoiceError`, `einvoiceSubmittedAt`. |
| POST | `/api/admin/orders/:orderId/einvoice/retry` | Admin / SuperAdmin | Manually retry a failed/skipped JOFOTARA e-invoice submission. Returns `{ ok, qr?, error?, uuid }`. |
| GET | `/api/admin/merchants/online` | Admin / SuperAdmin | Returns list of online merchant/store admins (from `/merchant-presence` socket). |

### Adjusted / Updated APIs

- **Stores (public)**  
  - All store responses now include **`status`** (`open` \| `paused` \| `closed`), **`isExclusive`** / **`isPremium`**, **`closingTime`** (string or `null`), **`openingTime`** (string or `null`), and **`storeCategories`** (array of `{ id, nameEn, nameAr, name }`).  
  - **`openingTime`** is derived from `openingHours.open` when present.  
  - **`arhebFee`** is never exposed in public APIs. **Blocked** and **`hiddenFromCustomers`** stores are excluded from browse; other stores may appear with `status: "paused"` or `"closed"` as appropriate.

- **Admin Stores**  
  - **GET** `/api/admin/stores` and **GET** `/api/admin/stores/:id`: **`arhebFee`** is included only for SuperAdmin; omitted for Admin and Store Admin. **`closingTime`** always included.  
  - **POST** `/api/admin/stores`: Body may include `closingTime`, and `arhebFee` (only applied if requester is SuperAdmin).  
  - **PATCH** `/api/admin/stores/:id`: **`closingTime`** allowed for all roles. **`arhebFee`** allowed only for SuperAdmin; others get `403` if sent. **`hiddenFromCustomers`**, **`isExclusive`** / **`isPremium`** (SuperAdmin/Admin), **`paused`**, **`blocked`** as documented in [Admin Stores](#admin-stores).  
  - **Clone** store: Copies `closingTime` and `arhebFee` from source; body may override `closingTime`.

- **Admin Orders**  
  - **GET** `/api/admin/orders`: Supports filter by **`status`** (exact value: e.g. `Waiting confirmation`, `Preparing`, `On the way`, `Delivered`, `Cancelled`) in addition to existing `orderType`, `dateFrom`, `dateTo`, `storeName`, `name`. **Admin/SuperAdmin** can filter by **`storeIds`** (comma-separated) to limit to one or more stores; Store Admin sees only their store.  
  - **GET** `/api/admin/orders/counts`: **Admin/SuperAdmin** can pass optional **`storeIds`** (comma-separated) to get active/delivered/cancelled counts for selected stores only. Returns `{ active, delivered, cancelled, complete }`.
  - **PATCH** `/api/admin/orders/:orderId/status`: when status is set to **`Preparing`** and order has no driver, backend invites the **nearest online** driver (if any) with FCM + **`delivery_request`** on `/driver-presence`; rejections chain to the next nearest driver.

- **Driver assigned lists (store + Arheb Box)**  
  - **`GET /api/driver/orders?filter=all`** and **`GET /api/driver/orders/assigned`** return a **merged**, **`createdAt`**-sorted list: store orders and **`arheb_box_requests`** rows with this **`driverId`**. Each element has **`orderType`**: **`store`** (full driver order object) or **`arheb_box`** (**`request`**: enriched box).

- **Driver order detail**  
  - **GET** `/api/driver/orders/:orderId` (and all driver order payloads): Response now includes **`storeName`**, **`storeAddress`**, **`storeMapsUrl`**, **`clientMapsUrl`** (Google Maps link for delivery address), **`numberOfItems`**, in addition to existing `totalPrice`, `deliveryFee`, `address`, and products.

- **Order tracking (WebSocket)**  
  - **Admin** role: Store Admin may connect only for orders where `order.storeId` is their store or `null`; otherwise connection is rejected.  
  - **Driver** role: Driver may connect only for orders assigned to them (`order.driverId === driver.id`); otherwise connection is rejected.  
  - New event **`status_update`**: Emitted to the order room when order status changes (e.g. **On the way**, **Delivered**). Payload: `{ orderId, status }`.  
  - Customer and admin observers receive **`location_update`** (unchanged) and **`status_update`** for live tracking while the order is active.

- **Contact / App Info**  
  - **GET** `/api/contact`: Response `data.contact` includes **`cliqNumber`**, **`driverDeliveryPercent`**, **`driverDeliveryDefaultEffective`** (see [Get Contact Information](#get-contact-information)).  
  - **GET** `/api/app_version` and **GET** `/app_version`: Public **`{ android, ios }`** strings from App info (see [App version (public)](#app-version-public)).  
  - **PUT** `/api/contact`: Body may include optional `cliqNumber` (string). If provided, it updates the stored Cliq number along with email/phone.  
  - **GET** `/api/admin/info` / **PATCH** `/api/admin/info` (see New APIs) — same row as contact plus **default driver delivery %**, **e-invoice pause**, **app version** fields, etc.

- **Checkout & Orders (Cliq payments)**  
  - **POST** `/api/checkout`:  
    - Accepts optional **`paymentVerificationImage`** (string URL) in the request body.  
    - When `paymentType` is `"Cliq"` (case-insensitive), new orders start with status **`'Waiting cliq confirmation'`** instead of `'Waiting confirmation'`.  
  - **GET** `/api/checkout` and **GET** `/api/checkout/:orderId`:  
    - Order objects now include **`paymentVerificationImage`** when present.  
  - **GET** `/api/home`:  
    - `activeOrder.status` can now also be `'Waiting cliq confirmation'` in addition to previous active statuses.

- **Driver Orders (visibility)**  
  - **GET** `/api/driver/home`:  
    - `availableOrders`: unassigned store orders with status **`Preparing`**.  
    - **`arhebBoxAvailable`**: Arheb Box requests assigned to this driver, status **`assigned`** (driver must accept then complete delivery).  
  - **GET** `/api/driver/orders?filter=available`:  
    - Same store orders as above, plus **`arhebBoxAvailable`** / **`arhebBoxAvailableCount`** for assigned Arheb Box jobs.

- **Admin Orders (Cliq review + tracking UI)**  
  - **GET** `/api/admin/orders` and **GET** `/api/admin/orders/:orderId`:  
    - Order objects now include **`paymentType`** and **`paymentVerificationImage`** (if present) for Cliq payments, enabling the dashboard to show the user’s payment screenshot.  
  - **PATCH** `/api/admin/orders/:orderId/status`:  
    - Admins can move Cliq orders from `'Waiting cliq confirmation'` → `'Waiting confirmation'` (approved) or to `'Payment rejected'` (rejected), which then flows through existing order processing as usual.

- **Stores (public + admin) – Store categories**  
  - All public store responses (`GET /api/stores`, `/api/stores/top-rated`, `/api/stores/premium`, `/api/stores/exclusive`, `/api/stores/category/:categoryName`) now include **`storeCategories`** (array) as part of each store.  
  - **GET** `/api/stores/:id/products` and **GET** `/api/stores/:id/products/category/:categoryName` include `store.storeCategories` so clients can know which categories belong to that store.  
  - **GET** `/api/stores/:id/products/paged?page=1` uses **per-store-category paging** (up to **10** products per **active** category per page, all categories + `other` in `data.categories`; see [Get Store Products (paginated)](#get-store-products-paginated)) for large catalogs; use instead of loading all products at once.  
  - **Admin** store APIs allow managing `storeCategories` per store; dashboard product forms now pick categories from the store’s own `storeCategories` instead of global categories.

### FCM, driver presence, store pause/block, customer orders & tracking, Arheb Box

- **Push notifications (FCM)**  
  - **Driver:** **PATCH** `/api/driver/fcm` – body `{ fcmToken }` to register/update token when driver is active. Drivers receive order notifications only in **Preparing** stage (request/auto-assign).  
  - **User:** **PUT** `/api/profile` and **POST** `/api/checkout` accept optional **`fcmToken`**. Users receive tracking notifications for: order confirmed/preparing, driver assigned/on-the-way, and near-arrival (0.5 km).  
  - **Broadcast:** **POST** `/api/admin/notifications/broadcast` (Admin/SuperAdmin) – body `{ title, body, imageUrl? }` sends FCM to all users with a stored token.
  - **FCM test:** **POST** `/api/admin/notifications/fcm-test` (**SuperAdmin only**) – body `{ fcmToken, title, body?, imageUrl? }` sends one notification for debugging. **`admin_fcm_test`** in `data.type`.
  - Tracking notifications include clickable data payload keys: `orderId`, `status`, `type`, `screen`, `deepLink`, `click_action`.

- **Notification `data.type` values (for app click handling)**
  - `order_tracking`: customer receives order status updates (e.g. `Waiting confirmation`, `Preparing`, `On the way`, `Delivered`)
  - `driver_request`: driver receives an order assignment/request in the **Preparing** stage
  - `order_near_arrival`: customer receives a one-time notification when driver is within **0.5 km**

- **Driver presence (WebSocket)**  
  - Drivers connect to Socket.IO namespace **`/driver-presence`** with driver JWT and emit **`location`** `{ latitude, longitude }`.  
  - **GET** `/api/admin/orders/:orderId/nearby-drivers` – returns **online** drivers with distance to store (when store has lat/long).  
  - **POST** `/api/admin/orders/:orderId/auto-assign` – Re-runs **cluster + assign** for the store (same rules as **PATCH → Preparing**). Returns **404** if this order could not get a driver (`no_driver_online` possible).  
  - **GET** `/api/admin/orders/:orderId/driver-map` – Store Admin / Admin / SuperAdmin: **`deliveryLocation`**, **`storeLocation`**, assigned **`driver`** (profile + **`liveLocation`** from presence), **`tracking`**, **`mapPreviewUrl`**.  
  - **POST** `/api/admin/orders/:orderId/request-driver` – **Admin / SuperAdmin only**: FCM + **`delivery_request`** socket to each listed driver (still uses accept flow).  
  - **GET** `/api/admin/drivers/active-map` – each driver includes **`currentStoreOrderId`** (latest) and **`currentStoreOrderIds`** (up to 25 active store orders).  
  - **Auto-assign FCM + socket:** **`driver_assigned`** / **`driver_request`** payloads; **`delivery_request`** on `/driver-presence` when connected.
  - For **`On the way`** orders, when driver gets within **0.5 km** of customer location, backend sends one-time **"order is near"** FCM notification to the user.

- **Categories (icons by language + Offers)**  
  - Category payloads now support **`iconAr`** and **`iconEn`** fields (stored and returned by categories APIs and admin category CRUD).
  - **GET** `/api/categories` now automatically includes a virtual **"Offers"** category (id `"offers"`, order `0`) as the first item when there are products with active discounts. The Offers category includes a `stores` array (visible stores with at least one discounted product), `storesCount`, and `productsCount`.

- **Admin Products search**  
  - **GET** `/api/admin/stores/:storeId/products` now accepts query param **`?name=text`** to filter products by name (searches `name`, `nameAr`, `nameEn`; case-insensitive partial match).

- **Stores: Pause, block, hide**  
  - Stores can be **paused**, **blocked**, or **hidden from browse** (`hiddenFromCustomers`). **Blocked** stores are excluded from all public store APIs. **Hidden** stores are excluded from browse lists but are not the same as paused. **`GET /api/stores`** can still list **paused** stores with `status: "paused"` (sorted after open). **PATCH** `/api/admin/stores/:id` accepts **`paused`** (any admin for their store), **`blocked`** (Admin/SuperAdmin only), and **`hiddenFromCustomers`**. Each pause/unpause is recorded in **`store_pause_events`**; **GET** `/api/admin/stores/pause-history` returns sessions and total paused duration for a date range (optional store filter for Admin/SuperAdmin).

- **Products: Related products**  
  - **GET** `/api/products/:id` response includes **`relatedProducts`** (array of up to 8 same-store products by name similarity). Documented in [Get Product by ID](#get-product-by-id).

- **Customer orders & tracking**  
  - **GET** `/api/checkout` returns **all** store orders for the user plus **`arhebBoxRequests`** (same user’s Arheb Box deliveries) and **`arhebBoxCount`**; each store order includes **`storeId`**, **`driverId`**, **`driverName`**.  
  - **GET** `/api/orders/:orderId` (customer auth) – returns order with **live status** and items for tracking by order ID.  
  - **GET** `/api/orders/:orderId/tracking` – response now includes **`data.status`** (current order status) in addition to location and driver connected.
  - Driver completion can include optional **`deliveryProofImage`** URL; it is stored on the order and visible in dashboard order details.

- **Arheb Box: FCM & drivers**  
  - **POST** `/api/arheb-box` accepts optional **`fcmToken`**; stored on the request and used for status notifications, and **requires `receiverPhone` + `receiverName`** so drivers can contact the receiver.  
  - **PATCH** `/api/admin/arheb-box/:id` (status) – sends FCM to the user on status change. When status is **delivered**, JoFotara is skipped if [e-invoice is paused](#admin-app-info-driver-delivery-default).  
  - **POST** `/api/admin/arheb-box/:id/assign-driver` – body `{ driverId }`; sets request to **assigned** and sends FCM to the driver.  
  - **POST** `/api/admin/arheb-box/:id/reassign-driver` – **Admin / SuperAdmin**; body `{ driverId }` — change driver, keep current status (in-flight; not delivered/cancelled).  
  - **POST** `/api/admin/arheb-box/:id/request-driver` – body `{ driverIds: [...] }` or `{ all: true }`. Broadcasts FCM + socket notifications to specified drivers (or all online drivers). Updates status to **confirmed**. Same accept/reject flow as store orders.  
  - **GET** `/api/driver/arheb-box` – list Arheb Box requests assigned to the driver, including **sender/receiver names & phones** and pickup/dropoff with `mapsUrl`.  
  - **POST** `/api/driver/arheb-box/:id/accept` – driver accepts; sets `driverId`/`driverName`, status → **`driver_to_pick`**, FCM to user (“driver assigned”). Accepts from **assigned**, **confirmed**, or **pending** (see [Driver workflow](#driver-workflow-store--arheb-box)).  
  - **POST** `/api/driver/arheb-box/:id/on-the-way` – status → **`on_the_way`**; customer “on the way” FCM.  
  - **POST** `/api/driver/arheb-box/:id/reject-request` – driver rejects a broadcast request; status stays **confirmed** (available for other drivers).  
  - **POST** `/api/driver/arheb-box/:id/complete` or **`/delivered`** – only assigned driver; requires **`on_the_way`** (or legacy **`in_progress`**) → **delivered**, FCM to customer.  
  - **POST** `/api/driver/orders/:orderId/complete`, **`/delivered`**, or **POST** `/api/driver/orders/complete` / **`/delivered`** with `{ orderId }` – store order **On the way** → **Delivered** (Bearer verifies driver). Accept sets store order to **Driver to pick** first.

- **Arheb Box: Card Payment**  
  - **POST** `/api/payment/arheb-box/initiate` (authenticated) – body: `{ arhebBox: { pickup, dropoff, receiverPhone, receiverName, paymentMethod, whoPays, amount, weightKg, notes, fcmToken }, currency?, customerName?, customerEmail?, customerPhone? }`. Creates an Arheb Box request with status **pending_payment**, initiates a PayTabs session (cart_id `ARHEBBOX-{id}-{timestamp}`). On callback/return success, status updates to **pending**.  
  - The existing **`/api/payment/callback`** and **`/api/payment/return`** handlers detect `ARHEBBOX-` prefix in cartId and update `arheb_box_requests` instead of `orders`.

- **Unified Admin Orders (Store + Arheb Box)**  
  - **GET** `/api/admin/orders` now returns both store orders and Arheb Box requests merged in a single list sorted by `createdAt DESC`. Each order includes an **`orderType`** field: `"store"` or `"arheb_box"`.  
  - Query param **`orderType=store`** returns only store orders; **`orderType=arheb_box`** returns only Arheb Box requests.  
  - Query param **`statusFilter`** replaces the old `orderType` for active/complete/delivered/cancelled filtering (backward compatible).  
  - **GET** `/api/admin/orders/counts` now includes Arheb Box counts in the totals.  
  - **GET** `/api/admin/orders/:orderId?type=arheb_box`** fetches Arheb Box request detail by ID.  
  - The admin dashboard orders page shows a **Type** column (Store Order / Arheb Box), **Payment Type** column, and an **Order Type** filter dropdown.

- **Driver Available Orders: Arheb Box**  
  - **GET** `/api/driver/home` and **GET** `/api/driver/orders?filter=available`** now include Arheb Box requests with status **confirmed** (broadcast, no driver assigned) alongside `assigned`/`in_progress` requests for the driver.  
  - **GET** `/api/driver/requests` returns both store order requests and Arheb Box requests in separate arrays: `requests` (store) and `arhebBoxRequests` (box).

- **Customer My Orders: Arheb Box**  
  - **GET** `/api/checkout` already returns **`arhebBoxRequests`** alongside store orders for the authenticated user.

### Driver commission, earnings APIs, customer driver ratings, delivery fees

- **Store orders:** Delivery fee uses **1 JOD first km + 0.1 JOD per additional km**, **max 3 JOD** (same basis as **POST /api/checkout/quote-fees** and checkout). **Arheb Box** uses a **different** formula for **`minAmountJod`**: **1 + 0.5×(km−1)** JOD, **no cap**.
- **Driver share:** **Per-driver `commissionPercent`** → **GET/PATCH /api/admin/info** **`driverDeliveryPercent`** → **GET/PATCH /api/admin/settings/driver-commission** (legacy global). **`GET/PATCH /api/admin/info`** is the preferred place for the app-wide default **percent** (0–1 or 0–100 accepted).
- **Order snapshot:** On **POST /api/driver/orders/accept**, the order stores **`driverCommissionType`**, **`driverCommissionValue`**, **`driverEarnings`**.
- **Driver app:** Order payloads include **`storeName`**, **`customerName`**, **`deliveryFee`**, **`profitJod`** (and **`driverShare`**), **`orderDate`** / **`createdAt`**, plus **`driverShare`** `{ commissionType, commissionValue, earningsJod }`. **GET /api/driver/home** and **GET /api/driver/stats** use **profit** (driver share), not raw delivery fee. **GET /api/driver/orders/assigned**, **GET /api/driver/earnings/today**, **GET /api/driver/earnings/summary** document earnings for drivers.
- **Customer:** **POST /api/orders/:orderId/rate-driver** — rate the driver 1–5 + optional notes; one rating per order; updates **`drivers.rating`** and **`ratingCount`**. See [Rate Driver (Customer)](#rate-driver-customer).
- **Customer:** **POST /api/orders/:orderId/cancel** — cancel own order when status is **Waiting confirmation**, **Preparing**, **Pending payment**, or **Waiting cliq confirmation**. Returns 400 if On the way / Delivered. See [Cancel Order (Customer)](#cancel-order-customer).
- **Admin dashboard:** **GET /api/admin/drivers/:id/profile** — filters, paginated orders with **`driverShare`**, **`earningsForFilteredDelivered`**, full **`ratings`** list. UI: **Drivers** → **Profile** → `/dashboard/drivers/profile/?id=` (static export–friendly URL).

<div align="center">

**Built with ❤️ for Arheb E-commerce Platform**

</div>
