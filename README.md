# Arheb Backend API Documentation

<div align="center">

**Complete REST API Documentation for Arheb E-commerce Backend**

[![API Version](https://img.shields.io/badge/API-v1.0-blue.svg)](https://arheb-backend.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Base URL:** `https://arheb-backend.onrender.com`

</div>

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

To create the **initial SuperAdmin** on first run, set in the backend `.env`:

- `SUPERADMIN_EMAIL` – email for the first SuperAdmin.
- `SUPERADMIN_PASSWORD` – password for the first SuperAdmin.

If no SuperAdmin exists, one is created at startup. Run the dashboard with `cd dashboard && npm install && npm run dev` (see `dashboard/README.md`).

---

## Deployment (e.g. Render) – no reset on redeploy

To avoid losing categories, stores, and products on every redeploy, use a **persistent directory** for the JSON data files.

1. **Create a persistent disk** (e.g. on Render: Dashboard → your service → Disks → Add Disk, mount path e.g. `/data`).
2. **Set the env var** in your service:
   - `ARHEB_JSON_DIR=/data`
   (Use the same path as the disk mount path.)
3. **Redeploy.** On first run the app copies the repo’s initial JSON files into that directory if they’re missing. After that, all reads and writes use that directory, so **redeploys no longer overwrite your data**.

If `ARHEB_JSON_DIR` is not set, the app uses the repo folder `Arheb API JSON` (current behaviour); data there is replaced on each deploy.

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
  - [Create Order](#create-order)
  - [Get All Orders](#get-all-orders)
  - [Get Order by ID](#get-order-by-id)
  - [Rate Order](#rate-order)
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
- [Driver API](#driver-api)
  - [Driver Send OTP](#driver-send-otp)
  - [Driver Login](#driver-login)
  - [Driver Home](#driver-home)
  - [Driver Stats](#driver-stats)
  - [Driver Orders List](#driver-orders-list)
  - [Driver Order Detail](#driver-order-detail)
  - [Driver Accept Order](#driver-accept-order)
  - [Driver Complete Order](#driver-complete-order)
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

Retrieves products with pagination support (20 products per page).

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
      "store": {
        "id": "1",
        "name": "كريسبي تشيكن"
      }
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Not Found Response (404):**
```json
{
  "success": false,
  "message": "Product not found"
}
```

---

## Stores

### Get All Stores

Retrieves all available stores.

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
        "isOpen": true
      }
    ]
  }
}
```

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
      "logo": "https://example.com/stores/crispy.png"
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
      "categoryEn": "Restaurant"
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

Retrieves all categories and subcategories.

**Endpoint:** `GET /api/categories`

**Authentication:** Not required

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "categories": [
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

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/categories');
const data = await response.json();
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

Retrieves home page data including banners, categories (from categories API), popular stores, and offers. When the user is authenticated, the response may include **activeOrder** (orderID and status) if they have an order in an active status.

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
    "offers": [...]
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
    "offers": [...]
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

Retrieves all orders for the authenticated user.

**Endpoint:** `GET /api/checkout`

**Authentication:** Required (Bearer token)

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
    "count": 5
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Get Order by ID

Retrieves a specific order by ID. Only returns orders belonging to the authenticated user.

**Endpoint:** `GET /api/checkout/:orderId`

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

## Order Tracking (WebSocket)

The Order Tracking system allows real-time tracking of orders using WebSocket connections. Drivers send location updates every 3 seconds, and customers receive these updates in real-time to track their delivery.

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

Arheb box requests are stored in the database (table `arheb_box_requests`) with id, date/time, username, phone number, status, pickup, dropoff, and notes. Admins can view and update status in the **dashboard** (Arheb Box page).

### Submit Arheb Box Request

Submits an Arheb box request with pickup location, dropoff location, and notes. Stored in DB with user's phone number and name; first status is `pending`.

**Endpoint:** `POST /api/arheb-box`

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "pickup": {
    "latitude": 29.5320,
    "longitude": 35.0063,
    "address": "العقبة، الأردن"
  },
  "dropoff": {
    "latitude": 31.9539,
    "longitude": 35.9106,
    "address": "عمان، الأردن"
  },
  "notes": "يرجى التوصيل قبل الساعة 5 مساءً"
}
```

**Required:**
- `pickup` (object) - `latitude` (number), `longitude` (number); `address` (string) optional
- `dropoff` (object) - `latitude` (number), `longitude` (number); `address` (string) optional
- `notes` (string) - optional

**Success Response (200):**
```json
{
  "success": true,
  "message": "Arheb box request received successfully",
  "data": {
    "request": {
      "pickup": { "latitude": 29.532, "longitude": 35.0063, "address": "العقبة، الأردن" },
      "dropoff": { "latitude": 31.9539, "longitude": 35.9106, "address": "عمان، الأردن" },
      "notes": "يرجى التوصيل قبل الساعة 5 مساءً"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/arheb-box', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-jwt-token-here'
  },
  body: JSON.stringify({
    pickup: { latitude: 29.532, longitude: 35.0063, address: 'العقبة، الأردن' },
    dropoff: { latitude: 31.9539, longitude: 35.9106, address: 'عمان، الأردن' },
    notes: 'يرجى التوصيل قبل الساعة 5 مساءً'
  })
});
const data = await response.json();
```

**Admin (dashboard):** Admins see all Arheb box requests in the dashboard under **Arheb Box**. They can update status (e.g. pending → confirmed → in_progress → delivered). Admin API: `GET /api/admin/arheb-box` (list), `PATCH /api/admin/arheb-box/:id` (body: `{ "status": "confirmed" }`).

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stores` | List stores (Store Admin sees only their store) |
| POST | `/api/admin/stores` | Create store (Admin and SuperAdmin only). Body: name, nameEn, nameAr, cover, logo, phone, address, addressEn, deliveryFee, minimumOrder, etc. |
| GET | `/api/admin/stores/:id` | Get one store |
| PATCH | `/api/admin/stores/:id` | Update store (name, nameAr, nameEn, cover, logo, deliveryTime, deliveryFee, minimumOrder, isOpen, openingHours, address, phone, category, etc.). **isPremium** only by SuperAdmin/Admin. |
| DELETE | `/api/admin/stores/:id` | Delete store (Admin and SuperAdmin only). Removes store and its products. |

---

### Admin Products

All under `/api/admin/stores/:storeId/products`. Store Admin can only access their store.

**Approval workflow:** When a **Store Admin** creates a product (POST), it is **not added directly** to the store. Instead, it enters a **pending approval queue**. A **SuperAdmin or Admin** must approve it before it becomes visible in the store and to users. If a **SuperAdmin or Admin** creates a product, it is added directly (no approval needed).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stores/:storeId/products` | List products for store |
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
| GET | `/api/admin/orders` | List orders (Store Admin: only their store). Each order includes driverId, driverName when assigned. Query: `dateFrom`, `dateTo`, `status`, `orderType` (`active` \| `complete`), `storeId`, `storeName`, `name` (customer name/phone). Sorted by `createdAt DESC, id DESC`. |
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
    "recentOrders": [
      { "id": 1, "totalAmount": 25.5, "status": "Delivered", "createdAt": "...", "storeId": "1" }
    ]
  }
}
```

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
| GET | `/api/admin/drivers` | List all drivers (id, name, mobile, email, vehicleType, vehicleNumber, licenseNumber, isBlocked, createdAt) |
| POST | `/api/admin/drivers` | Add driver. Body: `name`, `mobile` (required); `email`, `vehicleType`, `vehicleNumber`, `licenseNumber` (optional). No OTP. |
| PATCH | `/api/admin/drivers/:id` | Update driver and/or block. Body: any of `name`, `mobile`, `email`, `vehicleType`, `vehicleNumber`, `licenseNumber`, `isBlocked` (boolean). |
| DELETE | `/api/admin/drivers/:id` | Remove driver (unassigns from orders then deletes). |

---

## Driver API

Drivers are **added, removed, and blocked only by SuperAdmin and Admin** (see [Admin API – Drivers](#admin-drivers)). There is no public driver registration. Drivers authenticate with **OTP-based login only** (Send OTP → Login with mobile + OTP). **Blocked drivers** cannot log in and cannot access any driver data (home, stats, orders, accept, complete). All protected driver endpoints require a **Driver JWT** in the `Authorization` header as `Bearer <token>`, obtained from **Driver Login**.

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

Returns the driver's home dashboard: profile, stats (today/total earnings and orders), current order (one actively delivering), available orders (unassigned), and in-progress orders (assigned to this driver, delivering).

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
      "todayEarnings": 125.5,
      "todayOrders": 8,
      "totalEarnings": 3450.75,
      "totalOrders": 245,
      "rating": 4.8
    },
    "currentOrder": null,
    "availableOrders": [
      {
        "id": "20",
        "orderNumber": "ORD-0020",
        "products": [],
        "totalPrice": 50.0,
        "deliveryFee": 2.0,
        "address": "123 Main St",
        "addressName": "Home",
        "paymentMethod": "cash",
        "status": "ready",
        "orderDate": "2024-01-15T13:00:00Z",
        "driver": null,
        "driver_latitude": null,
        "driver_longitude": null
      }
    ],
    "inProgressOrders": []
  }
}
```

---

### Driver Stats

Returns earnings and order stats for the driver (optionally filtered by period).

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
      "earnings": 125.5,
      "earningsGrowth": 15,
      "totalOrders": 8,
      "completedOrders": 7,
      "cancelledOrders": 1,
      "avgDeliveryTime": 25,
      "rating": 4.8,
      "totalReviews": 245
    }
  }
}
```

---

### Driver Orders List

Returns a paginated list of orders for the driver. Filter: `all` (orders assigned to driver), `available` (unassigned orders), or `mine` / `in_progress` (assigned, not yet delivered).

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
        "totalPrice": 50.0,
        "deliveryFee": 2.0,
        "address": "123 Main St",
        "status": "delivered",
        "orderDate": "2024-01-10T12:00:00Z",
        "driver": { "id": "1", "name": "Ahmed Driver", "mobile": "0790000000", "rating": 4.8 },
        "driver_latitude": 29.532,
        "driver_longitude": 35.0063
      }
    ]
  }
}
```

---

### Driver Order Detail

Returns full details for a single order. Driver can only access orders that are unassigned or assigned to them.

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
      "products": [...],
      "totalPrice": 50.0,
      "deliveryFee": 2.0,
      "address": "123 Main St",
      "addressName": "Home",
      "paymentMethod": "cash",
      "status": "delivering",
      "orderDate": "2024-01-10T12:00:00Z",
      "notes": "Leave at the door",
      "driver": { "id": "1", "name": "Ahmed Driver", "mobile": "0790000000", "latitude": 29.532, "longitude": 35.0063, "rating": 4.8 },
      "driver_latitude": 29.532,
      "driver_longitude": 35.0063
    }
  }
}
```

**Error Responses:** `403` – Access denied (order assigned to another driver), `404` – Order not found

---

### Driver Accept Order

Assigns an order to the authenticated driver and sets its status to "On the way".

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

Marks an order as delivered. Order must be assigned to the authenticated driver.

**Endpoint:** `POST /api/driver/orders/complete`

**Authentication:** Required (Driver Bearer token)

**Request Body:**
```json
{
  "orderId": "1",
  "driverId": "1",
  "completedAt": "2024-01-15T14:30:00Z"
}
```

`driverId` and `completedAt` are optional; driver is taken from token.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order completed successfully",
  "data": {
    "order": {
      "id": "20",
      "orderNumber": "ORD-0020",
      "status": "delivered",
      "driver": { "id": "1", "name": "Ahmed Driver", ... }
    }
  }
}
```

**Error Responses:** `403` – Order not assigned to you, `404` – Order not found

---

### Driver API Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/driver/send-otp` | No | Send OTP (mock; returns verificationId) |
| POST | `/api/driver/login` | No | Login with mobile + otpCode; returns driver + token (blocked drivers get 403) |
| GET | `/api/driver/home` | Yes | Driver dashboard (blocked drivers get 403) |
| GET | `/api/driver/stats` | Yes | Stats (earnings, orders, period) |
| GET | `/api/driver/orders` | Yes | List orders (filter, page, perPage) |
| GET | `/api/driver/orders/:orderId` | Yes | Order detail |
| POST | `/api/driver/orders/accept` | Yes | Accept order (assign to driver) |
| POST | `/api/driver/orders/complete` | Yes | Mark order delivered |

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
- ✅ **Driver API**: Send OTP, Login (token stored), Home, Stats, Orders list/detail, Accept order, Complete order. **Admin**: List/Add/Block/Remove drivers.
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

**Last updated: 2026-01-31**

### New APIs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/orders/:orderId/available-drivers` | Admin (Store Admin: own store orders only) | Returns non-blocked drivers that do not already have a pending request for this order. Used when assigning a driver to an order. |
| POST | `/api/admin/orders/:orderId/request-driver` | Admin (Store Admin: own store orders only) | Sends a delivery request to one or more drivers. Body: `{ "driverIds": [1, 2, 3] }`. Allowed only when order status is "Preparing" or "Waiting confirmation" and order has no driver assigned. |
| GET | `/api/admin/orders/:orderId/tracking` | Admin (Store Admin: own store orders only) | Returns order tracking state for the dashboard: `orderId`, `orderStatus`, `driverId`, `driverName`, `isTracking`, `driverConnected`, `lastLocation` (latitude, longitude, timestamp). Used with Socket.IO for live driver tracking. |
| GET | `/api/driver/requests` | Driver | Returns pending delivery requests for the authenticated driver. Each request includes full order payload (store name/address/mapsUrl, client address, total, delivery fee, item count, etc.). Driver accepts via existing `POST /api/driver/orders/accept`. |
| GET | `/api/admin/info` | Admin / SuperAdmin | Returns app-level contact info and Cliq number for the platform: `{ email, phone, cliqNumber }`. Used by the admin dashboard `App info` page. |
| PATCH | `/api/admin/info` | Admin / SuperAdmin | Updates app contact info and Cliq number. Body: any subset of `{ email, phone, cliqNumber }`. Missing fields are left unchanged. |
| POST | `/api/admin/stores/:storeId/products/import` | Admin / SuperAdmin / Store Admin (per-store) | Imports products for a store from an Excel file. Expects `multipart/form-data` with field `file` (`.xlsx`/`.xls`). Store Admin rows go to the pending products queue; Admin/SuperAdmin rows are imported directly. |
| GET | `/api/admin/stores/:storeId/products/export` | Admin / SuperAdmin / Store Admin (per-store) | Exports all products for the given store as an Excel file. Columns include `nameEn`, `nameAr`, `price`, `discount`, `unit`, `category`, `description`, `stock`, `isAvailable`. |

### Adjusted / Updated APIs

- **Stores (public)**  
  - All store responses now include **`closingTime`** (string or `null`).  
  - **`arhebFee`** is never exposed in public APIs.

- **Admin Stores**  
  - **GET** `/api/admin/stores` and **GET** `/api/admin/stores/:id`: **`arhebFee`** is included only for SuperAdmin; omitted for Admin and Store Admin. **`closingTime`** always included.  
  - **POST** `/api/admin/stores`: Body may include `closingTime`, and `arhebFee` (only applied if requester is SuperAdmin).  
  - **PATCH** `/api/admin/stores/:id`: **`closingTime`** allowed for all roles. **`arhebFee`** allowed only for SuperAdmin; others get `403` if sent.  
  - **Clone** store: Copies `closingTime` and `arhebFee` from source; body may override `closingTime`.

- **Admin Orders**  
  - **GET** `/api/admin/orders`: Supports filter by **`status`** (exact value: e.g. `Waiting confirmation`, `Preparing`, `On the way`, `Delivered`, `Cancelled`) in addition to existing `orderType`, `dateFrom`, `dateTo`, `storeId`, `storeName`, `name`.

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
    - `availableOrders` now includes only **unassigned orders with status `Preparing`**.  
  - **GET** `/api/driver/orders?filter=available`:  
    - Returns only unassigned orders where `status = 'Preparing'`. Other filters (`mine`, `in_progress`, `all`) continue to show orders assigned to the authenticated driver.

- **Admin Orders (Cliq review + tracking UI)**  
  - **GET** `/api/admin/orders` and **GET** `/api/admin/orders/:orderId`:  
    - Order objects now include **`paymentType`** and **`paymentVerificationImage`** (if present) for Cliq payments, enabling the dashboard to show the user’s payment screenshot.  
  - **PATCH** `/api/admin/orders/:orderId/status`:  
    - Admins can move Cliq orders from `'Waiting cliq confirmation'` → `'Waiting confirmation'` (approved) or to `'Payment rejected'` (rejected), which then flows through existing order processing as usual.

- **Stores (public + admin) – Store categories**  
  - All public store responses (`GET /api/stores`, `/api/stores/top-rated`, `/api/stores/premium`, `/api/stores/category/:categoryName`) now include **`storeCategories`** (array) as part of each store.  
  - **GET** `/api/stores/:id/products` and **GET** `/api/stores/:id/products/category/:categoryName` include `store.storeCategories` so clients can know which categories belong to that store.  
  - **Admin** store APIs allow managing `storeCategories` per store; dashboard product forms now pick categories from the store’s own `storeCategories` instead of global categories.

---

## Support

For issues or questions, please contact: `contact@arheb.app`

---

<div align="center">

**Built with ❤️ for Arheb E-commerce Platform**

</div>
