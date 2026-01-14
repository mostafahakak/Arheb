# Arheb Backend API Documentation

**Base URL:** `https://arheb-backend.onrender.com`

This backend provides authentication via Firebase phone OTP and serves product, store, category, and home data.

---

## Table of Contents

- [Authentication Endpoints](#authentication-endpoints)
  - [Register/Send OTP](#registersend-otp)
  - [Verify OTP](#verify-otp)
  - [Delete User](#delete-user)
- [Data Endpoints](#data-endpoints)
  - [Categories](#categories)
  - [Products](#products)
  - [Stores](#stores)
  - [Home](#home)

---

## Authentication Endpoints

### Register/Send OTP

Send an OTP code to a phone number for authentication.

**Endpoint:** `POST /api/auth/register`

**Request Body:**
```json
{
  "phoneNumber": "+201500157920",
  "recaptchaToken": "optional-recaptcha-token"
}
```

**Response (Success):**
```json
{
  "message": "OTP SENT SUCCESSFUL",
  "case": 1,
  "alreadyRegistered": false,
  "sessionInfo": "session-info-string-from-firebase"
}
```

**Response (Error):**
```json
{
  "message": "Error message from Firebase",
  "case": 2
}
```

**Example (JavaScript/Fetch):**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    phoneNumber: '+201500157920',
    recaptchaToken: 'your-recaptcha-token' // optional
  })
});

const data = await response.json();
console.log(data.sessionInfo); // Save this for verify-otp
```

---

### Verify OTP

Verify the OTP code and receive authentication tokens.

**Endpoint:** `POST /api/auth/verify-otp`

**Request Body:**
```json
{
  "phoneNumber": "+201500157920",
  "sessionInfo": "session-info-from-register-response",
  "otp": "111111"
}
```

**Response (Success):**
```json
{
  "success": true,
  "token": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "firebaseToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjA4MmU5NzVlMDdkZmE0OTYwYzdiN2I0ZmMxZDEwZjkxNmRjMmY1NWIiLCJ0eXAiOiJKV1QifQ...",
  "phoneNumber": "+201500157920"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Error message from Firebase"
}
```

**Example (JavaScript/Fetch):**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/auth/verify-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    phoneNumber: '+201500157920',
    sessionInfo: 'session-info-from-register',
    otp: '111111'
  })
});

const data = await response.json();
if (data.success) {
  // Save tokens for authenticated requests
  const authToken = data.token; // Bearer token
  const firebaseToken = data.firebaseToken; // Firebase ID token
  console.log('Authenticated!', authToken);
}
```

---

### Delete User

Delete a user account from Firebase Auth and the database. Requires authentication.

**Endpoint:** `DELETE /api/auth/user`

**Headers:**
```
Authorization: Bearer <token-from-verify-otp>
Content-Type: application/json
```

**Request Body:**
```json
{
  "firebaseIdToken": "firebase-token-from-verify-otp-response"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "User deleted"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Error message"
}
```

**Example (JavaScript/Fetch):**
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

const data = await response.json();
console.log(data);
```

---

## Data Endpoints

All data endpoints are public and do not require authentication.

### Categories

Get all categories and subcategories.

**Endpoint:** `GET /api/categories`

**Response:**
```json
{
  "success": true,
  "message": "Categories retrieved successfully",
  "data": {
    "categories": [
      {
        "id": "1",
        "name": "supermarket",
        "nameAr": "سوبر ماركت",
        "nameEn": "Supermarket",
        "image": "https://example.com/categories/supermarket.png",
        "isComingSoon": false,
        "order": 1,
        "subCategories": []
      }
    ]
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/categories');
const data = await response.json();
console.log(data.data.categories);
```

---

### Products

Get products listing with pagination, filters, and sorting options.

**Endpoint:** `GET /api/products`

**Response:**
```json
{
  "success": true,
  "message": "Products listing retrieved successfully",
  "data": {
    "products": [
      {
        "id": "1",
        "name": "وجبة فردية",
        "nameAr": "وجبة فردية",
        "nameEn": "Single Meal",
        "image": "https://example.com/products/meal1.jpg",
        "images": ["https://example.com/products/meal1.jpg"],
        "price": 4.5,
        "originalPrice": 5.0,
        "discount": "10",
        "unit": "قطعة",
        "unitAr": "قطعة",
        "unitEn": "piece",
        "category": "وجبات سريعة",
        "categoryAr": "وجبات سريعة",
        "categoryEn": "Fast Food",
        "description": "...",
        "descriptionAr": "...",
        "descriptionEn": "...",
        "stock": 5,
        "isAvailable": true,
        "store": {
          "id": "1",
          "name": "كريسبي تشيكن",
          "nameAr": "كريسبي تشيكن",
          "nameEn": "Crispy Chicken",
          "cover": "https://example.com/stores/crispy_cover.jpg",
          "logo": "https://example.com/stores/crispy.png",
          "rate": 4.9,
          "numberOfReviews": 100,
          "isFavorite": false
        }
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 3,
      "totalItems": 25,
      "itemsPerPage": 10,
      "hasNextPage": true,
      "hasPreviousPage": false
    },
    "filters": { ... },
    "sortingOptions": [ ... ]
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/products');
const data = await response.json();
console.log(data.data.products);
```

---

### Stores

Get stores listing with filters and sorting options.

**Endpoint:** `GET /api/stores`

**Response:**
```json
{
  "success": true,
  "message": "Stores listing retrieved successfully",
  "data": {
    "stores": [
      {
        "id": "1",
        "name": "كريسبي تشيكن",
        "nameAr": "كريسبي تشيكن",
        "nameEn": "Crispy Chicken",
        "cover": "https://example.com/stores/crispy_cover.jpg",
        "logo": "https://example.com/stores/crispy.png",
        "rate": 4.9,
        "numberOfReviews": 100,
        "isFavorite": false,
        "deliveryTime": "30-45 min",
        "deliveryFee": 2.5,
        "minimumOrder": 15.0,
        "isOpen": true,
        "openingHours": {
          "open": "09:00",
          "close": "23:00"
        },
        "address": "شارع الملك حسين، العقبة",
        "addressAr": "شارع الملك حسين، العقبة",
        "addressEn": "King Hussein Street, Aqaba",
        "phone": "+962 3 201 2345",
        "category": "restaurants",
        "categoryAr": "مطاعم",
        "categoryEn": "Restaurants"
      }
    ],
    "pagination": { ... },
    "sortingOptions": [ ... ],
    "filters": { ... },
    "location": { ... }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/stores');
const data = await response.json();
console.log(data.data.stores);
```

---

### Home

Get home page data including banners, categories, popular stores, and offers.

**Endpoint:** `GET /api/home`

**Response:**
```json
{
  "success": true,
  "message": "Home data retrieved successfully",
  "data": {
    "banners": [
      {
        "id": "1",
        "image": "https://example.com/banners/banner1.png",
        "title": "Banner 1",
        "link": "https://example.com/promotion1",
        "order": 1
      }
    ],
    "categories": [ ... ],
    "mostPopularStores": [ ... ],
    "offers": [ ... ]
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```javascript
const response = await fetch('https://arheb-backend.onrender.com/api/home');
const data = await response.json();
console.log(data.data.banners);
console.log(data.data.categories);
console.log(data.data.mostPopularStores);
console.log(data.data.offers);
```

---

## Authentication Flow

1. **Register/Send OTP**: Call `POST /api/auth/register` with a phone number to receive a `sessionInfo`.
2. **Verify OTP**: Call `POST /api/auth/verify-otp` with the `sessionInfo` and OTP code to receive authentication tokens.
3. **Authenticated Requests**: Use the `token` (Bearer token) in the `Authorization` header for protected endpoints.

**Example Flow:**
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
const firebaseToken = verifyData.firebaseToken; // Firebase ID token

// Step 3: Use token for authenticated requests
const deleteResponse = await fetch('https://arheb-backend.onrender.com/api/auth/user', {
  method: 'DELETE',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': authToken // Bearer token
  },
  body: JSON.stringify({ firebaseIdToken: firebaseToken })
});
```

---

## Error Handling

All endpoints return appropriate HTTP status codes:

- `200` - Success
- `400` - Bad Request (missing/invalid parameters)
- `401` - Unauthorized (missing/invalid token)
- `404` - Not Found (invalid endpoint)
- `500` - Internal Server Error

Error responses typically include a `message` field with details.

---

## Testing

A test client is available at: `https://arheb-backend.onrender.com/test-client/index.html`

This page allows you to test the authentication flow (register, verify OTP, delete user) and view sample responses from all data endpoints.

---

## Notes

- Phone numbers should be in E.164 format (e.g., `+201500157920`).
- JWT tokens expire after 7 days.
- All timestamps are in ISO 8601 format (UTC).
- The backend uses Firebase Authentication for phone number verification.
- Data endpoints return cached/static data from JSON files.
