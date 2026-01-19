# Arheb Backend API Documentation

<div align="center">

**Complete REST API Documentation for Arheb E-commerce Backend**

[![API Version](https://img.shields.io/badge/API-v1.0-blue.svg)](https://arheb-backend.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Base URL:** `https://arheb-backend.onrender.com`

</div>

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
  - [Get Store Products](#get-store-products)
- [Categories](#categories)
- [Home](#home)
- [Profile](#profile)
  - [Get Profile](#get-profile)
  - [Update Profile](#update-profile)
- [Checkout & Orders](#checkout--orders)
  - [Create Order](#create-order)
  - [Get All Orders](#get-all-orders)
  - [Get Order by ID](#get-order-by-id)
  - [Rate Order](#rate-order)
- [Promo Codes](#promo-codes)
  - [Validate Promo Code](#validate-promo-code)
- [Contact](#contact)
  - [Get Contact Information](#get-contact-information)
  - [Update Contact Information (Admin)](#update-contact-information-admin)
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

### Key Features

- **Authentication**: Firebase phone OTP verification with JWT tokens
- **Pagination**: Efficient product listing with pagination
- **Store Ratings**: Dynamic rating system that updates store averages
- **Order Management**: Complete order lifecycle management
- **Admin Controls**: Admin-only endpoints for contact management
- **Promo Codes**: Promo code validation and automatic discount application

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

## Categories

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

---

## Home

Retrieves home page data including banners, categories, popular stores, and offers.

**Endpoint:** `GET /api/home`

**Authentication:** Not required

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

---

## Profile

### Get Profile

Retrieves the authenticated user's profile information.

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
      "addressName": "Home Address",
      "addressLong": 35.0063,
      "addressLat": 29.5320
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Update Profile

Updates the authenticated user's profile information.

**Endpoint:** `PUT /api/profile`

**Authentication:** Required (Bearer token)

**Request Body (all fields optional):**
```json
{
  "name": "John Doe",
  "addressName": "Work Address",
  "addressLong": 35.0063,
  "addressLat": 29.5320
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "profile": {
      "phoneNumber": "+201500157920",
      "name": "John Doe",
      "addressName": "Work Address",
      "addressLong": 35.0063,
      "addressLat": 29.5320
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/profile', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-jwt-token-here'
  },
  body: JSON.stringify({
    name: 'John Doe',
    addressName: 'Work Address'
  })
});
```

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
- ✅ Test profile management
- ✅ Create and manage orders
- ✅ Validate promo codes
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

---

## Support

For issues or questions, please contact: `contact@arheb.com`

---

<div align="center">

**Built with ❤️ for Arheb E-commerce Platform**

</div>
