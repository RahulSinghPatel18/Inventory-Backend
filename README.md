# Inventory Management Backend

## Day 1 — Basic Setup & Product CRUD

### Setup
- Node.js project setup
- `npm init`
- Express, Mongoose, dotenv install
- Basic Express server
- MongoDB Atlas connection
- `.env` setup

### Project Structure
- `server.js`
- `app.js`
- `config/db.js`
- `models/Product.js`
- `routes/productRoutes.js`
- `controllers/productController.js`

### Product
- Product Schema/Model
- Fields: name, price, quantity, category
- Mongoose validation

### CRUD APIs
- Create → `POST`
- Get All → `GET`
- Get By ID → `GET`
- Update → `PUT`
- Delete → `DELETE`

### Testing & Git
- Postman API testing
- MongoDB data verification
- Invalid data testing
- `.gitignore` and `.env` protection
- GitHub push

---

## Day 2 — Request Handling & Error Handling

### Concepts
- `req.body` → request data
- `req.params` → URL parameters
- `req.query` → URL query parameters
- `async/await` → asynchronous operations
- `try/catch` → error handling
- `ObjectId.isValid()` → MongoDB ID validation
- `400` → invalid request/data
- `404` → resource not found
- `runValidators` → update validation

### CRUD Improvements
- Invalid ID handling
- Product Not Found handling
- Update validation
- Proper error responses

---

## Current Progress

Basic Server       ✅
MongoDB            ✅
Mongoose           ✅
Model              ✅
Routes             ✅
Controllers        ✅
CRUD               ✅
Validation         ✅
Error Handling     ✅
Postman            ✅
Git/GitHub         ✅

## API Flow

Client / Postman
       ↓
server.js
       ↓
app.js
       ↓
Routes
       ↓
Controllers
       ↓
Product Model
       ↓
Mongoose
       ↓
MongoDB Atlas



---

## Day 3 — Middleware, Authentication & User Management

### Middleware

* Middleware concept
* `req`, `res`, `next`
* Global Middleware
* Route-specific Middleware
* Logger Middleware
* Request Method, URL and Time logging
* Middleware execution flow

### Authentication

* API Key Authentication concept
* JWT Authentication
* `bcryptjs` for password hashing
* `jsonwebtoken` for JWT
* User Registration
* User Login
* JWT Token Generation
* JWT Token Verification
* `Authorization` Header
* `Bearer Token`
* Protected Routes

### User Management

* User Schema/Model
* Name, Email and Password fields
* Duplicate User checking
* Password Hashing
* Password Verification
* Login Authentication
* Profile API
* Logged-in User data

### JWT Concepts

* `jwt.sign()`
* `jwt.verify()`
* JWT Payload
* `decoded`
* `req.user = decoded`
* `req.user.userId`
* `next()` after successful authentication

### Additional Concepts

* HTTP Headers
* `Authorization` Header
* `Bearer` authentication format
* `req.body` for login/register data
* `req.headers` for authentication data
* Protected API request flow

### Current Progress

Middleware              ✅
Logger Middleware       ✅
User Model              ✅
User Registration       ✅
Password Hashing        ✅
User Login              ✅
JWT Authentication      ✅
JWT Middleware          ✅
Protected Routes        ✅
Profile API             ✅
Postman Testing         ✅

### Authentication Flow

Register

↓

Password Hashing

↓

MongoDB

↓

Login

↓

JWT Token

↓

Authorization Header

↓

JWT Middleware

↓

Token Verification

↓

`req.user`

↓

Protected Controller

↓

User Data
