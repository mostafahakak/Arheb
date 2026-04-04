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
- **Arheb Box**: Admins can view all Arheb box requests (id, date/time, username, phone, pickup, dropoff, notes, status) and update status (pending → confirmed → in_progress → delivered → cancelled). Requests are submitted by users with Bearer token and stored in the database.
- **English and Arabic** (language switcher in the UI).
- **Driver earnings:** Admin/SuperAdmin can set **global driver commission** (percent of delivery fee or fixed JOD per delivery) under **App info** (`/dashboard/info/`). The **Drivers** list links to a **driver profile** page (`/dashboard/drivers/profile/?id=`) with filters (status, date range), delivered-order profit totals, and full customer **driver ratings** (stars + notes). Drivers only see their **average rating** in the driver app, not individual reviews.

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
- **Driver presence**: Drivers connect to the **Socket.IO namespace `/driver-presence`** with their driver JWT and send `location` events (`latitude`, `longitude`). The server keeps a list of active drivers and their last location. Admin can request **nearby drivers** for an order (by distance to store) and **auto-assign** the nearest active driver; the driver is notified via FCM.
- **User FCM**: Users can set `fcmToken` via **PUT /api/profile** or send it with **POST /api/checkout**. Order status changes (and broadcast notifications) are sent to the user’s token. **GET /api/profile/notifications** lists notification history for that user only (Bearer user JWT).
- **Store FCM**: Store devices (kitchen / POS) register a token with **POST /api/store/update-fcm** (`storeId`, `fcmToken`). Tokens are stored in the database and returned on **GET / PATCH** admin store details as `fcmToken`. When a customer order is created (**POST /api/checkout** or payment flow that creates an order), the backend sends a push to that store’s token if configured (`type: store_new_order` in the data payload).
- **Broadcast**: Admin/SuperAdmin can send a notification to all registered users via **POST /api/admin/notifications/broadcast** (`title`, `body`, optional `imageUrl`).

---

## 📋 Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
  - [Register / Send OTP](#register--send-otp)
  - [Verify OTP](#verify-otp)
  - [Delete User](#delete-user)
- [Products](#products)
  - [Get Products (Paginated)](#get-products-paginated)
  - [Get Product by ID](#get-product-by-id)
- [Stores](#stores)
  - [Get All Stores](#get-all-stores)
  - [Get Top Rated Stores](#get-top-rated-stores)
  - [Get Premium Stores](#get-premium-stores)
  - [Get Stores by Category](#get-stores-by-category)
  - [Update Store FCM Token](#update-store-fcm-token)
  - [Get Store Products](#get-store-products)
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
- [Popup](#popup)
  - [Get Popup](#get-popup)
- [Arheb Box](#arheb-box)
  - [Submit Arheb Box Request](#submit-arheb-box-request)
- [Contact](#contact)
  - [Get Contact Information](#get-contact-information)
  - [Update Contact Information (Admin)](#update-contact-information-admin)
- [Admin API](#admin-api)
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
  - [Admin Driver Profile (detail)](#admin-driver-profile-detail)
- [Driver API](#driver-api)
  - [Driver Send OTP](#driver-send-otp)
  - [Driver Login](#driver-login)
  - [Driver Home](#driver-home)
  - [Driver Stats](#driver-stats)
  - [Driver Orders List](#driver-orders-list)
  - [Driver Order Detail](#driver-order-detail)
  - [Driver Accept Order](#driver-accept-order)
  - [Driver Complete Order](#driver-complete-order)
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
- 🚗 Driver API (login, orders, accept, complete)

### Key Features

- **Authentication**: Firebase phone OTP verification with JWT tokens
- **Pagination**: Efficient product listing with pagination
- **Store Ratings**: Dynamic rating system that updates store averages
- **Order Management**: Complete order lifecycle management
- **Admin Controls**: Admin-only endpoints for contact management
- **Promo Codes**: Promo code validation and automatic discount application
- **Real-time Tracking**: WebSocket-based order tracking with driver location updates every 3 seconds
- **Driver App**: Drivers can register/login with OTP, view home (stats, current/available/in-progress orders), list orders, accept and complete orders

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

Stores can be **paused** (hidden from users; admins see status "Paused") or **blocked** (hidden from users; only Admin/SuperAdmin can unblock; Store Admin cannot edit or add/remove products). Paused and blocked stores are excluded from all public store APIs (`GET /api/stores`, top-rated, premium, by category, and store products). Admin APIs return all stores and support `paused` and `blocked` via `PATCH /api/admin/stores/:id`.

### Get All Stores

Retrieves all available (non-paused, non-blocked) stores.

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
        "closingTime": "23:00",
        "openingTime": "09:00",
        "storeCategories": [
          { "id": "1", "nameEn": "Meals", "nameAr": "وجبات", "name": "Meals" }
        ]
      }
    ]
  }
}
```

Each store includes **`closingTime`** (string or `null`), **`openingTime`** (string or `null`), and **`storeCategories`** (array of `{ id, nameEn, nameAr, name }`) so the client can show store hours and product categories offered by the store.

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
        { "id": "1", "nameEn": "Meals", "nameAr": "وجبات", "name": "Meals" }
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

Retrieves home page data including banners, categories (from categories API), popular stores, and offers. When the user is authenticated, the response may include **activeOrder** (orderID and status) if they have an order in an active status. The response also includes **`discountedProducts`**: a list of products that currently have a discount (same shape as in [Get Products](#get-products-paginated)).

**Endpoint:** `GET /api/home`

**Authentication:** Optional. If `Authorization: Bearer <token>` is sent and valid, the response may include `activeOrder` when the user has an order in "Waiting confirmation", "Being prepared", or "On the way".

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "banners": [...],
    "categories": [...],
    "mostPopularStores": [...],
    "offers": [...],
    "discountedProducts": [
      {
        "id": "1",
        "name": "وجبة فردية",
        "price": 4.5,
        "originalPrice": 5.0,
        "discount": "10"
      }
    ]
  }
}
```

**With active order (when user sends Bearer token and has an order in active status):**
```json
{
  "success": true,
  "data": {
    "banners": [...],
    "categories": [...],
    "mostPopularStores": [...],
    "offers": [...],
    "discountedProducts": [...]
  },
  "activeOrder": {
    "orderID": 42,
    "status": "Being prepared"
  }
}
```

**Note:** `activeOrder` is only present when the user is authenticated and has at least one order with status `Waiting confirmation`, `Being prepared`, or `On the way`. The latest such order is returned (orderID and status only).

**Example (with token to get activeOrder):**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/home', {
  headers: { 'Authorization': 'Bearer your-jwt-token-here' }
});
const data = await response.json();
if (data.activeOrder) {
  console.log('Active order:', data.activeOrder.orderID, data.activeOrder.status);
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

Call **before** `POST /api/checkout` to preview **delivery fee**, **service fee**, and **VAT** using the same rules as **Arheb Box** for delivery pricing, with **7% VAT on the delivery fee only** (not on the order subtotal and not on the service fee — same as store checkout).

**Endpoint:** `POST /api/checkout/quote-fees`

**Authentication:** Required (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|--------|------|----------|-------------|
| `storeId` | string | Yes | Store id (must exist in `stores_listing_response.json`). |
| `storeLocation` | object | No | Optional. If sent, it can be used for client-side display only. Server now resolves store location from `storeId` + store `mapsUrl` / store coordinates. |
| `deliveryLocation` | object | Yes | Customer drop-off: **`latitude`** and **`longitude`** (numbers). |
| `weightKg` | number | No | Cart / shipment weight in kg for delivery pricing (default `0`). Same weight basis as checkout’s server-side delivery fee. |

**Example:**

```json
{
  "storeId": "1",
  "deliveryLocation": { "latitude": 29.54, "longitude": 35.01 },
  "weightKg": 2.5
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
    "minAmountJod": 2,
    "weightKg": 2.5,
    "currency": "JOD",
    "deliveryFee": 1.38,
    "serviceFee": 0.65,
    "feesTaxRate": 0.07,
    "feesTax": 0.22,
    "feesTaxNote": "7% VAT on delivery fee only (not on order subtotal or service fee).",
    "invoiceTotal": 2.25,
    "pricingNote": "Delivery fee matches Arheb Box: route minimum (1 JOD/km, floor 2 JOD) + 0.15 JOD/kg, capped at 3 JOD. distanceKm and minAmountJod describe the route (same haversine rules as POST /api/arheb-box/quote)."
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

- **`deliveryFee`**: Same formula as **Arheb Box** / store checkout: **route minimum** (`minAmountJod` from distance: 1 JOD/km, **minimum 2 JOD**) **+ 0.15 × weightKg** JOD, rounded to 2 decimals, then **capped at a maximum of 3 JOD**.
- **`serviceFee`**: fixed **0.65** JOD.
- **`feesTax`**: **7% × deliveryFee** only.
- **`invoiceTotal`**: `deliveryFee + serviceFee + feesTax` (fees-only total; does **not** include cart subtotal).
- **`distanceKm` / `minAmountJod`**: route metrics (1 JOD/km, minimum 2 JOD — same helper as **POST /api/arheb-box/quote**); informational for the client.
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
- `nearby` (string) - Nearby landmark
- `notes` (string) - Additional notes

**Note:** 
- Status is automatically set to "Waiting confirmation"
- If `promoCode` is provided and valid, the discount will be automatically applied from the promo code value
- If `promoCode` is invalid, order creation will fail with "invalid promoCode"

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

The same response also includes **`arhebBoxRequests`**: all **Arheb Box** requests created by this user (same shape as `GET /api/arheb-box/:id` — pickup/dropoff with `mapsUrl`, `amount`, `paymentMethod`, `whoPays`, `driverPhone` when assigned, etc.), plus **`arhebBoxCount`**.

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
    "arhebBoxCount": 0
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

**Authentication:** Required (Bearer user token)

**Path parameters:** `orderId` – order ID

**Request body:**
```json
{
  "rating": 5,
  "notes": "Optional short comment"
}
```

- **`rating`** (required): integer **1–5**
- **`notes`** (optional): string (trimmed, max length enforced server-side)

**Rules:**
- Order must belong to the authenticated user (`userId` / `phoneNumber` match).
- Order **`status`** must be **`Delivered`** and a **`driverId`** must be set.
- **One rating per order** (unique on `orderId`).

**Success (201):**
```json
{
  "success": true,
  "message": "Thank you for your feedback",
  "data": {
    "rating": 5,
    "driverRatingAvg": 4.85
  }
}
```

**Errors:** `400` (not delivered / no driver / invalid rating / already rated), `403` (not your order), `404` (order not found).

**Driver app:** Drivers see **average rating** (and aggregate stats where returned); they do **not** receive per-customer review text in the public driver profile payload. **Admin dashboard** can list full rating rows (order id, stars, notes, date) on the driver profile API.

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

**Connection Requirements:**
- `token` - Bearer JWT token from authentication
- `orderId` - Order ID to track

**Connection Example (Socket.IO):**
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
- `Authentication failed: Token and orderId are required`
- `Authentication failed: Invalid token`
- `Order not found`
- `Unauthorized: You are not authorized to track this order`

**Driver Location Errors:**
- `Only drivers can send location updates`
- `Invalid coordinates`

**Customer Errors:**
- `Access denied` (not order owner)

---

## Promo Codes

### Validate Promo Code

Validates a promo code and returns its discount value.

**Endpoint:** `GET /api/promo-codes/:code`

**Authentication:** Not required

**Path Parameters:**
- `code` - Promo code name

**Success Response (200):**
```json
{
  "success": true,
  "message": "promocode Value is 10.0",
  "data": {
    "value": 10.0,
    "name": "SAVE10"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Not Found Response (404):**
```json
{
  "success": false,
  "message": "promCode not available"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/promo-codes/SAVE10');
const data = await response.json();

if (data.success) {
  console.log(`Promo code value: ${data.data.value}`);
}
```

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

Requests are stored in `arheb_box_requests` with **sender/receiver** contacts, pickup & dropoff (lat/lng + address + `mapsUrl`), **payment** (`paymentMethod`, `whoPays`: `sender` | `receiver`), **trip amount** (`amount` in JOD), **distance** and **minimum price** (`distanceKm`, `minAmountJod`). Pricing: **1 JOD per km**, **minimum 2 JOD** (e.g. 3 km → at least 3 JOD; 0.5 km → at least 2 JOD), **+ 0.15 JOD/kg** weight component where applicable, with the **computed delivery fee capped at 3 JOD** (same basis as store checkout / quote-fees). The client must call **quote** first, then send an `amount` ≥ `minAmountJod`. After a driver is assigned, **customer** `GET /api/arheb-box/:id` and list/detail responses include **`driverPhone`**.

### Arheb Box quote (distance & minimum amount)

**Endpoint:** `POST /api/arheb-box/quote`  
**Authentication:** Not required

**Body:** same `pickup` / `dropoff` shape as submit (each with `latitude`, `longitude`).

**Response:** `{ distanceKm, minAmountJod, currency: "JOD" }`

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

**Admin (dashboard):** `GET /api/admin/arheb-box`, `PATCH /api/admin/arheb-box/:id`, `POST /api/admin/arheb-box/:id/assign-driver`. Admin/driver responses include pricing fields and **`driverPhone`** when applicable.

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
      "phone": "+201234567890"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

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

## Admin API

All admin endpoints require **Admin JWT** authentication. Send the token in the `Authorization` header as `Bearer <token>`. The token is obtained from `POST /api/admin/login`. Roles: **SuperAdmin**, **Admin**, **Store Admin**. Store Admin can only access their assigned store.

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
| POST | `/api/admin/stores` | Create store (Admin and SuperAdmin only). Body: name, nameEn, nameAr, cover, logo, phone, address, addressEn, deliveryFee, minimumOrder, etc. |
| GET | `/api/admin/stores/:id` | Get one store |
| PATCH | `/api/admin/stores/:id` | Update store (name, nameAr, nameEn, cover, logo, deliveryTime, deliveryFee, minimumOrder, isOpen, openingHours, address, phone, category, closingTime, storeCategories, etc.). **isPremium** only by SuperAdmin/Admin. **storeCategories** is an array of `{ id, nameEn, nameAr, name }`. |
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
| GET | `/api/admin/orders` | List orders (Store Admin: only their store). Each order includes driverId, driverName when assigned. Query: `dateFrom`, `dateTo`, `status`, `orderType` (`active` \| `complete`), `storeId`, `storeIds`, `storeName`, `name` (customer name/phone), `paymentType` (`cash`, `Cliq`, `card`, etc.). Sorted by `createdAt DESC, id DESC`. |
| GET | `/api/admin/orders/:orderId` | Get one order with full details (items, address, notes, paymentType, storeName, driverId, driverName, etc.). Store Admin: only their store. |
| PATCH | `/api/admin/orders/:orderId/status` | Update order status. Body: `{ "status": "Confirmed" }`. |
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
| PATCH | `/api/admin/arheb-box/:id` | Update request status. Body: `{ "status": "confirmed" }` (e.g. pending, confirmed, in_progress, delivered, cancelled). |

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
| GET | `/api/admin/drivers` | List all drivers (`id`, `name`, `mobile`, `email`, `vehicleType`, `vehicleNumber`, `licenseNumber`, `photo`, `latitude`, `longitude`, **`rating`**, **`ratingCount`**, `isVerified`, `isBlocked`, `createdAt`). |
| POST | `/api/admin/drivers` | Add driver. Body: `name`, `mobile` (required); `email`, `vehicleType`, `vehicleNumber`, `licenseNumber` (optional). No OTP. |
| PATCH | `/api/admin/drivers/:id` | Update driver and/or block. Body: any of `name`, `mobile`, `email`, `vehicleType`, `vehicleNumber`, `licenseNumber`, `isBlocked` (boolean). |
| DELETE | `/api/admin/drivers/:id` | Remove driver (unassigns from orders then deletes). |

---

### Admin Driver Commission

**Access:** SuperAdmin and Admin only.

Global settings for how much of each order’s **delivery fee** is recorded as the driver’s **earnings** when a driver is assigned. Default: **`percent`** with value **`0.65`** (65% of the delivery fee). Alternative: **`fixed`** — a flat amount in **JOD** per assigned order (capped so it never exceeds that order’s delivery fee).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/settings/driver-commission` | Returns `{ commissionType: "percent" \| "fixed", commissionValue: number }`. |
| PATCH | `/api/admin/settings/driver-commission` | Body: `commissionType` and/or `commissionValue`. For **percent**, use a decimal **0–1** (e.g. `0.65`) or **0–100** (e.g. `65`) — both are accepted. |

On **accept** (`POST /api/driver/orders/accept`), the server snapshots **`driverCommissionType`**, **`driverCommissionValue`**, and **`driverEarnings`** on the order row so later changes to global settings do not rewrite past assignments.

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
- **`globalCommission`**: current global commission settings (same as GET driver-commission).
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

Returns the driver's home dashboard: profile, stats (**today/total profit** = driver share of delivery fees, plus delivery-fee totals), current order (one actively delivering), **available store orders** (unassigned `Preparing`), **Arheb Box jobs awaiting pickup** (`arhebBoxAvailable`: assigned to this driver, status `assigned` — accept then complete via Arheb Box APIs), and in-progress store orders.

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
    "arhebBoxAvailable": [],
    "inProgressOrders": []
  }
}
```

`arhebBoxAvailable` is an array of enriched Arheb Box requests (same shape as driver Arheb Box list) for deliveries admin-assigned to this driver that still need **accept** → **complete**.

- **`todayProfit` / `totalProfit`**: sum of **`driverEarnings`** (or computed share) on **Delivered** orders (today vs all time).
- **`todayDeliveryFees` / `totalDeliveryFees`**: sum of **`deliveryFee`** on those same sets (informational).
- **`todayEarnings` / `totalEarnings`**: aliases for **`todayProfit` / `totalProfit`** (backward compatible).

---

### Driver Stats

Returns earnings and order stats for the driver (optionally filtered by period). **`stats.earnings`** and **`stats.profit`** are the driver’s **share** (same number). **`totalReviews`** is the driver’s **`ratingCount`**.

**Endpoint:** `GET /api/driver/stats?period=today`

**Authentication:** Required (Driver Bearer token)

**Query Parameters:** `period` (optional) – e.g. `today` (default) or other period.

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
      "earningsGrowth": 15,
      "totalOrders": 8,
      "completedOrders": 7,
      "cancelledOrders": 1,
      "avgDeliveryTime": 25,
      "rating": 4.8,
      "totalReviews": 42
    }
  }
}
```

---

### Driver Orders List

Returns a paginated list of orders for the driver. Filter: `all` (orders assigned to driver), `available` (unassigned **store** orders in `Preparing`), or `mine` / `in_progress` (assigned, not yet delivered). When **`filter=available`**, the response also includes **`arhebBoxAvailable`** and **`arhebBoxAvailableCount`**: Arheb Box requests assigned to this driver with status **`assigned`** (mirror of home).

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
      }
    ]
  }
}
```

Each order includes **`driverShare`** when the response is built with commission resolution (assigned orders). See [Driver order object (fields)](#driver-order-object-fields).

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

Assigns an order to the authenticated driver and sets its status to "On the way". Persists **commission snapshot** fields on the order (`driverCommissionType`, `driverCommissionValue`, `driverEarnings`) from current [Admin Driver Commission](#admin-driver-commission) settings.

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

**Effect:** The order's `status` is set to **"On the way"**, and **`driverId`** and **`driverName`** are set on the order so Admin can track which driver is assigned (see Admin Orders).

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

### Driver Complete Order

Marks a **store order** as **Delivered**. The **Bearer token** identifies the driver; the server checks that this driver is assigned to the order. Order status must be **On the way** (after accept). Idempotent: if already **Delivered**, returns success with the same message variant.

**Endpoints (choose one):**

| Method | Path | Body |
|--------|------|------|
| POST | `/api/driver/orders/:orderId/complete` | Optional: `{ "deliveryProofImage": "https://..." }` |
| POST | `/api/driver/orders/complete` | `{ "orderId": 20, "deliveryProofImage": "https://..." }` |

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

### Driver Complete Arheb Box (delivery)

Marks an **Arheb Box** request **delivered** from the driver app. **Bearer** must be the driver **assigned** to the request; status must be **`in_progress`** (after **POST** `/api/driver/arheb-box/:id/accept`). Sends FCM to the customer.

**Endpoint:** `POST /api/driver/arheb-box/:id/complete`

**Authentication:** Required (Driver Bearer token)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Arheb Box marked as delivered successfully",
  "data": { "request": { "id": 1, "status": "delivered", "...": "..." } }
}
```

**Error Responses:** `400` – Not in `in_progress`; `403` – Request not assigned to this driver; `404` – Request not found. Already **delivered** → `200` with message that it was already complete.

---

### Driver order object (fields)

On driver-facing order objects (`GET /api/driver/home`, `GET /api/driver/orders`, `GET /api/driver/orders/assigned`, `GET /api/driver/orders/:orderId`, `POST /api/driver/orders/accept`, complete-order responses, etc.), each order includes:

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

Explicit list of **all orders assigned to this driver** (same underlying data as `GET /api/driver/orders?filter=all`), with pagination.

**Endpoint:** `GET /api/driver/orders/assigned?page=1&perPage=20`

**Authentication:** Required (Driver Bearer token)

**Query:** `page`, `perPage` (same limits as main orders list).

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
| POST | `/api/driver/orders/accept` | Yes | Accept order (assign to driver) |
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
- ⏰ All timestamps are in **ISO 8601 format** (UTC)
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

**Last updated: 2026-03-26**

### New APIs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/checkout/quote-fees` | User (Bearer) | Pre-checkout quote: `storeId` and `deliveryLocation` (lat/long), optional `weightKg`. Returns delivery fee (Arheb Box formula), service fee, 7% VAT on delivery fee only, route `distanceKm` / `minAmountJod`. |
| GET | `/api/admin/drivers/active-map` | Admin / SuperAdmin | Returns drivers on **`/driver-presence`** (non-stale): `{ city, center, activeDriversCount, driversWithLocationCount, drivers[] }`. Each driver includes `hasLocation`, `latitude`, `longitude` (null until the app emits `location`), `lastSeen`. |
| GET | `/api/admin/orders/:orderId/available-drivers` | Admin (Store Admin: own store orders only) | Returns non-blocked drivers that do not already have a pending request for this order. Used when assigning a driver to an order. |
| POST | `/api/admin/orders/:orderId/request-driver` | Admin (Store Admin: own store orders only) | Sends a delivery request to one or more drivers. Body: `{ "driverIds": [1, 2, 3] }`. Allowed only when order status is "Preparing" or "Waiting confirmation" and order has no driver assigned. |
| GET | `/api/admin/orders/:orderId/tracking` | Admin (Store Admin: own store orders only) | Returns order tracking state for the dashboard: `orderId`, `orderStatus`, `driverId`, `driverName`, `isTracking`, `driverConnected`, `lastLocation` (latitude, longitude, timestamp). Used with Socket.IO for live driver tracking. |
| GET | `/api/driver/requests` | Driver | Returns pending delivery requests for the authenticated driver. Each request includes full order payload (store name/address/mapsUrl, client address, total, delivery fee, item count, etc.). Driver accepts via existing `POST /api/driver/orders/accept`. |
| GET | `/api/admin/info` | Admin / SuperAdmin | Returns app-level contact info and Cliq number for the platform: `{ email, phone, cliqNumber }`. Used by the admin dashboard `App info` page. |
| PATCH | `/api/admin/info` | Admin / SuperAdmin | Updates app contact info and Cliq number. Body: any subset of `{ email, phone, cliqNumber }`. Missing fields are left unchanged. |
| POST | `/api/admin/stores/:storeId/products/import` | Admin / SuperAdmin / Store Admin (per-store) | Imports products for a store from an Excel file. Expects `multipart/form-data` with field `file` (`.xlsx`/`.xls`). Store Admin rows go to the pending products queue; Admin/SuperAdmin rows are imported directly. Rows with an `id` column that already exists for the store are **skipped** (no duplicate). Export includes `id` column. |
| GET | `/api/admin/stores/:storeId/products/export` | Admin / SuperAdmin / Store Admin (per-store) | Exports all products for the given store as an Excel file. Columns include `id`, `nameEn`, `nameAr`, `price`, `discount`, `unit`, `category`, `description`, `stock`, `isAvailable`. |
| POST | `/api/admin/orders/:orderId/reject` | Admin (Store Admin: own store only) | Reject (cancel) an order when status is **Waiting confirmation** or **Waiting cliq confirmation**. Sets status to `Cancelled` and sends FCM to the customer. |
| GET | `/api/admin/stores/pause-history` | Admin | Returns store pause history: sessions (pausedAt, unpausedAt, durationMinutes) and total duration. Query: `dateFrom`, `dateTo` (default today), optional `storeIds` (comma-separated). Store Admin sees only their store. |
| GET | `/api/admin/notifications` | Admin / SuperAdmin | Returns list of sent broadcast notifications (id, title, body, imageUrl, successCount, failureCount, createdAt) for the dashboard history. |
| POST | `/api/admin/notifications/broadcast` | Admin / SuperAdmin | Sends FCM to all users. Body: `{ title, body, imageUrl? }`. Each broadcast is **saved** to the `Notifications` table for later retrieval via GET `/api/admin/notifications`. |
| GET | `/api/profile/notifications` | User (Bearer) | In-app notification inbox: paginated list (`page`, `perPage`) of notifications **sent to this user only**. Persisted in `user_notifications` when FCM is sent (per-user pushes and broadcast). Each item includes `data` (FCM payload: `orderId`, `deepLink`, `type`, …). |

| POST | `/api/payment/initiate` | User (Bearer) | Creates order from **`checkout`** body (card only), then Madfoat session. Returns **201** with `data.checkout` (same shape as POST /api/checkout) and `data.payment` (`tranRef`, `redirectUrl`, etc.). Saves `paymentTranRef` / `paymentCartId` on the order. |
| GET | `/api/payment/client-key` | None | Returns client key and profile ID for managed-form (paylib.js) frontend integration. |
| GET | `/api/payment/query/:tranRef` | User (Bearer) | Query transaction status from Madfoat by transaction reference. |
| POST | `/api/payment/refund` | User (Bearer) | Full or partial refund of a completed transaction. Body: `{ tranRef, amount?, description? }`. |
| GET | `/api/payment/transactions` | User (Bearer) | List payment transactions with optional filters (`orderId`, `status`, `page`, `perPage`). |
| POST | `/api/payment/callback` | None (Madfoat server-to-server) | Receives payment result from Madfoat after hosted page completion. Verifies HMAC signature. Not called by client. |
| GET | `/api/payment/return` | None (browser redirect) | Browser landing page after payment. Shows HTML success/failure. |

### Adjusted / Updated APIs

- **Stores (public)**  
  - All store responses now include **`closingTime`** (string or `null`), **`openingTime`** (string or `null`), and **`storeCategories`** (array of `{ id, nameEn, nameAr, name }`).  
  - **`openingTime`** is derived from `openingHours.open` when present.  
  - **`arhebFee`** is never exposed in public APIs.

- **Admin Stores**  
  - **GET** `/api/admin/stores` and **GET** `/api/admin/stores/:id`: **`arhebFee`** is included only for SuperAdmin; omitted for Admin and Store Admin. **`closingTime`** always included.  
  - **POST** `/api/admin/stores`: Body may include `closingTime`, and `arhebFee` (only applied if requester is SuperAdmin).  
  - **PATCH** `/api/admin/stores/:id`: **`closingTime`** allowed for all roles. **`arhebFee`** allowed only for SuperAdmin; others get `403` if sent.  
  - **Clone** store: Copies `closingTime` and `arhebFee` from source; body may override `closingTime`.

- **Admin Orders**  
  - **GET** `/api/admin/orders`: Supports filter by **`status`** (exact value: e.g. `Waiting confirmation`, `Preparing`, `On the way`, `Delivered`, `Cancelled`) in addition to existing `orderType`, `dateFrom`, `dateTo`, `storeName`, `name`. **Admin/SuperAdmin** can filter by **`storeIds`** (comma-separated) to limit to one or more stores; Store Admin sees only their store.  
  - **GET** `/api/admin/orders/counts`: **Admin/SuperAdmin** can pass optional **`storeIds`** (comma-separated) to get active/delivered/cancelled counts for selected stores only. Returns `{ active, delivered, cancelled, complete }`.
  - **PATCH** `/api/admin/orders/:orderId/status`: when status is set to **`Preparing`** and order has no driver, backend auto-assigns nearest active driver (if available) and sends FCM to driver with order/store details.

- **Driver order detail**  
  - **GET** `/api/driver/orders/:orderId` (and all driver order payloads): Response now includes **`storeName`**, **`storeAddress`**, **`storeMapsUrl`**, **`clientMapsUrl`** (Google Maps link for delivery address), **`numberOfItems`**, in addition to existing `totalPrice`, `deliveryFee`, `address`, and products.

- **Order tracking (WebSocket)**  
  - **Admin** role: Store Admin may connect only for orders where `order.storeId` is their store or `null`; otherwise connection is rejected.  
  - **Driver** role: Driver may connect only for orders assigned to them (`order.driverId === driver.id`); otherwise connection is rejected.  
  - New event **`status_update`**: Emitted to the order room when driver accepts (status `"On the way"`) or completes (status `"Delivered"`). Payload: `{ orderId, status }`.  
  - Customer and admin observers receive **`location_update`** (unchanged) and **`status_update`** for live tracking from driver accept until delivery.

- **Contact / App Info**  
  - **GET** `/api/contact`: Response `data.contact` now includes **`cliqNumber`** in addition to `email` and `phone`.  
  - **PUT** `/api/contact`: Body may include optional `cliqNumber` (string). If provided, it updates the stored Cliq number along with email/phone.  
  - **GET** `/api/admin/info` / **PATCH** `/api/admin/info` (see New APIs) provide an admin-only way to view and update the same contact info used by the app.

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
  - All public store responses (`GET /api/stores`, `/api/stores/top-rated`, `/api/stores/premium`, `/api/stores/category/:categoryName`) now include **`storeCategories`** (array) as part of each store.  
  - **GET** `/api/stores/:id/products` and **GET** `/api/stores/:id/products/category/:categoryName` include `store.storeCategories` so clients can know which categories belong to that store.  
  - **Admin** store APIs allow managing `storeCategories` per store; dashboard product forms now pick categories from the store’s own `storeCategories` instead of global categories.

### FCM, driver presence, store pause/block, customer orders & tracking, Arheb Box

- **Push notifications (FCM)**  
  - **Driver:** **PATCH** `/api/driver/fcm` – body `{ fcmToken }` to register/update token when driver is active. Drivers receive order notifications only in **Preparing** stage (request/auto-assign).  
  - **User:** **PUT** `/api/profile` and **POST** `/api/checkout` accept optional **`fcmToken`**. Users receive tracking notifications for: order confirmed/preparing, driver assigned/on-the-way, and near-arrival (0.5 km).  
  - **Broadcast:** **POST** `/api/admin/notifications/broadcast` (Admin/SuperAdmin) – body `{ title, body, imageUrl? }` sends FCM to all users with a stored token.
  - Tracking notifications include clickable data payload keys: `orderId`, `status`, `type`, `screen`, `deepLink`, `click_action`.

- **Notification `data.type` values (for app click handling)**
  - `order_tracking`: customer receives order status updates (e.g. `Waiting confirmation`, `Preparing`, `On the way`, `Delivered`)
  - `driver_request`: driver receives an order assignment/request in the **Preparing** stage
  - `order_near_arrival`: customer receives a one-time notification when driver is within **0.5 km**

- **Driver presence (WebSocket)**  
  - Drivers connect to Socket.IO namespace **`/driver-presence`** with driver JWT and emit **`location`** `{ latitude, longitude }`.  
  - **GET** `/api/admin/orders/:orderId/nearby-drivers` – returns active drivers with distance to store (when store has lat/long).  
  - **POST** `/api/admin/orders/:orderId/auto-assign` – assigns the nearest active driver and sends FCM to that driver.  
  - **POST** `/api/admin/orders/:orderId/request-driver` – sends FCM to each requested driver.
  - **Driver assignment FCM (manual + auto):** In all cases above, plus **PATCH** `/api/admin/orders/:orderId/status` → **`Preparing`** when the backend auto-assigns the nearest driver, the driver push includes **`type: driver_request`**, **`orderId`**, **`deepLink`: `arheb://orders/{orderId}`**, **`screen: order_details`**, **`click_action`**, and store fields where applicable — tap should open the driver’s order details for that `orderId`.
  - For **`On the way`** orders, when driver gets within **0.5 km** of customer location, backend sends one-time **"order is near"** FCM notification to the user.

- **Categories (icons by language + Offers)**  
  - Category payloads now support **`iconAr`** and **`iconEn`** fields (stored and returned by categories APIs and admin category CRUD).
  - **GET** `/api/categories` now automatically includes a virtual **"Offers"** category (id `"offers"`, order `0`) as the first item when there are products with active discounts. The Offers category includes a `stores` array (visible stores with at least one discounted product), `storesCount`, and `productsCount`.

- **Admin Products search**  
  - **GET** `/api/admin/stores/:storeId/products` now accepts query param **`?name=text`** to filter products by name (searches `name`, `nameAr`, `nameEn`; case-insensitive partial match).

- **Stores: Pause & Block**  
  - Stores can be **paused** (hidden from users; admins see status “Paused”) or **blocked** (hidden from users; only Admin/SuperAdmin can unblock; Store Admin cannot edit or add/remove products).  
  - Public store APIs exclude paused and blocked stores. **PATCH** `/api/admin/stores/:id` accepts **`paused`** (any admin for their store) and **`blocked`** (Admin/SuperAdmin only). Each pause/unpause is recorded in **`store_pause_events`**; **GET** `/api/admin/stores/pause-history` returns sessions and total paused duration for a date range (optional store filter for Admin/SuperAdmin).

- **Products: Related products**  
  - **GET** `/api/products/:id` response includes **`relatedProducts`** (array of up to 8 same-store products by name similarity). Documented in [Get Product by ID](#get-product-by-id).

- **Customer orders & tracking**  
  - **GET** `/api/checkout` returns **all** store orders for the user plus **`arhebBoxRequests`** (same user’s Arheb Box deliveries) and **`arhebBoxCount`**; each store order includes **`storeId`**, **`driverId`**, **`driverName`**.  
  - **GET** `/api/orders/:orderId` (customer auth) – returns order with **live status** and items for tracking by order ID.  
  - **GET** `/api/orders/:orderId/tracking` – response now includes **`data.status`** (current order status) in addition to location and driver connected.
  - Driver completion can include optional **`deliveryProofImage`** URL; it is stored on the order and visible in dashboard order details.

- **Arheb Box: FCM & drivers**  
  - **POST** `/api/arheb-box` accepts optional **`fcmToken`**; stored on the request and used for status notifications, and **requires `receiverPhone` + `receiverName`** so drivers can contact the receiver.  
  - **PATCH** `/api/admin/arheb-box/:id` (status) – sends FCM to the user on status change.  
  - **POST** `/api/admin/arheb-box/:id/assign-driver` – body `{ driverId }`; sets request to **assigned** and sends FCM to the driver.  
  - **GET** `/api/driver/arheb-box` – list Arheb Box requests assigned to the driver, including **sender/receiver names & phones** and pickup/dropoff with `mapsUrl`.  
  - **POST** `/api/driver/arheb-box/:id/accept` – driver accepts; status → **in_progress**, FCM sent to user.  
  - **POST** `/api/driver/arheb-box/:id/complete` – Bearer + request id; only assigned driver; **in_progress** → **delivered**, FCM to sender.  
  - **POST** `/api/driver/orders/:orderId/complete` or **POST** `/api/driver/orders/complete` with `{ orderId }` – store order **On the way** → **Delivered** (Bearer verifies driver).

### Driver commission, earnings APIs, customer driver ratings, delivery fee cap

- **Delivery fee cap:** Store checkout and **POST /api/checkout/quote-fees** use the same helper as Arheb Box: **route minimum (1 JOD/km, floor 2 JOD) + 0.15 JOD/kg**, rounded to 2 decimals, **capped at 3 JOD** maximum.
- **Admin:** **GET/PATCH** `/api/admin/settings/driver-commission` — global **`commissionType`** (`percent` \| `fixed`) and **`commissionValue`** (percent as 0–1 or 0–100; fixed as JOD). Default **percent 0.65**. Dashboard: **App info** page (`/dashboard/info/`).
- **Order snapshot:** On **POST /api/driver/orders/accept**, the order stores **`driverCommissionType`**, **`driverCommissionValue`**, **`driverEarnings`**.
- **Driver app:** Order payloads include **`storeName`**, **`customerName`**, **`deliveryFee`**, **`profitJod`** (and **`driverShare`**), **`orderDate`** / **`createdAt`**, plus **`driverShare`** `{ commissionType, commissionValue, earningsJod }`. **GET /api/driver/home** and **GET /api/driver/stats** use **profit** (driver share), not raw delivery fee. **GET /api/driver/orders/assigned**, **GET /api/driver/earnings/today**, **GET /api/driver/earnings/summary** document earnings for drivers.
- **Customer:** **POST /api/orders/:orderId/rate-driver** — rate the driver 1–5 + optional notes; one rating per order; updates **`drivers.rating`** and **`ratingCount`**. See [Rate Driver (Customer)](#rate-driver-customer).
- **Admin dashboard:** **GET /api/admin/drivers/:id/profile** — filters, paginated orders with **`driverShare`**, **`earningsForFilteredDelivered`**, full **`ratings`** list. UI: **Drivers** → **Profile** → `/dashboard/drivers/profile/?id=` (static export–friendly URL).

---

## Support

For issues or questions, please contact: `contact@arheb.app`

---

<div align="center">

**Built with ❤️ for Arheb E-commerce Platform**

</div>
