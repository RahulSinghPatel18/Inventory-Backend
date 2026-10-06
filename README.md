# InventoryStack Backend

REST API for inventory management, built with Node.js, Express and MongoDB/Mongoose.

## Features

- Account registration/login, bcrypt password hashing and JWT authentication.
- Organization-scoped members, categories, products and stock history.
- Organization-scoped customers, sales, append-only payments, customer ledgers and sales analytics.
- Permission-based Sales, Customers, Udhaar and Analytics access for organization members (admins bypass permissions).
- Product/category CRUD and inventory statistics.
- Stock in/out, movement history, low/out-of-stock alerts and summaries.
- Input validation, pagination, search, indexes, CORS allow-list and auth rate limits.

## Request flow

```text
Client → server.js → app.js → routes → middleware → controllers
       → Mongoose models → MongoDB
```

- `server.js`: loads `.env`, checks `MONGO_URI`/`JWT_SECRET`, connects DB, starts server.
- `app.js`: configures CORS, security headers, JSON parsing, routes, 404 and error handling.
- `routes/`: maps HTTP paths to controller functions.
- `middleware/`: JWT, admin authorization, rate limiting and request logging.
- `controllers/`: validates input, applies business rules, queries models and returns JSON.
- `models/`: MongoDB schemas, references, validation and indexes.
- `utils/`: shared input validation and controller error handling.

## Run locally

Requires Node.js, npm and a MongoDB deployment that supports transactions (Atlas/replica set).

1. Install dependencies: `npm install`
2. Create `.env` in the project root:

   ```env
   MONGO_URI=<MongoDB connection string>
   JWT_SECRET=<long private random secret>
   PORT=3000
   NODE_ENV=development
   GMAIL_CLIENT_ID=<Google OAuth client ID with Gmail API access>
   GMAIL_CLIENT_SECRET=<Google OAuth client secret>
   GMAIL_REFRESH_TOKEN=<Google OAuth refresh token>
   GMAIL_USER=<verified Gmail sender address>
   ```

3. Start: `npm run dev` (development) or `npm start`.
4. Check `GET http://localhost:3000/`.

Keep `.env` private and untracked. Add extra exact frontend origins with comma-separated `CORS_ORIGINS`. Behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact trusted hop count.
Set `VITE_API_URL` and `VITE_GMAIL_CLIENT_ID` in the frontend environment. The frontend client ID must match backend `GMAIL_CLIENT_ID`; configure deployed frontend origins in Google OAuth as authorized JavaScript origins. `GMAIL_CLIENT_SECRET` and the Gmail refresh token remain backend-only; never put them in the frontend environment. Gmail API credentials are required whenever 2FA or password-reset email delivery is used.

## Authentication

- Email/password registration validates the name, email, organization and password, then emails a 6-digit registration code. The organization and administrator are created together in a MongoDB transaction only after OTP verification; successful verification returns a JWT and signs the user in. Registration OTPs expire after 10 minutes, allow five attempts and can be resent after 60 seconds. Pending registration data is held in memory until verification, so production deployments need a single instance/sticky routing or a shared ephemeral store.
- Google sign-in verifies the Google ID token on the server and requires a verified Google email. Existing accounts are found by Google ID or verified email and retain their database role and organization. A new Google identity receives a short-lived signed setup token; only after the user submits an organization name does the server create the organization and admin account. Google registration does not use registration email OTP.
- Administrators default to email 2FA enabled; regular users default to disabled. When enabled, password login emails a single-use 6-digit code, valid for 10 minutes, before issuing an access token. Codes are limited to one send per account per minute. Google authentication uses the verified Google credential and does not use email OTP. Users can change the 2FA preference in Settings. For legacy administrators without a saved preference, 2FA is treated as enabled.
- A completed login returns a JWT signed with `HS256`, valid for one day. Roles and organization IDs in protected requests are revalidated against the database.
- Login, Google sign-in, registration completion and profile responses include the user's database-backed `permissions` array (empty for users without assigned permissions); the JWT middleware separately reloads permissions from the database for authorization.
- Send the token to protected APIs:

  ```http
  Authorization: Bearer <JWT_TOKEN>
  ```

- Products, categories and stock require JWT. Product and category create/update/delete require admin; organization members can read categories and use stock operations.
- Data queries are scoped by the token's `organizationId`.
- Organization members sign in with the password set by their administrator and must change that temporary password on first sign-in. Administrators can update members, activate/deactivate accounts, delete regular members, or set a new password in their organization only.
- Forgot-password requests return the same message whether or not an account exists. A 6-digit code is emailed, expires after 10 minutes, allows up to five verification attempts, and is limited to one send per minute. A successful code verification issues a short-lived one-use reset token. 2FA and password-reset emails use the MYStockHHub text wordmark, plain-text fallback, expiry and security guidance. Gmail API credentials must be configured for delivery.
- The product-facing term is **member**. `/users` route paths, the `User` MongoDB model, the JWT `userId` claim, the `user` response field, and the `user` role value are retained as internal compatibility names.
- Completed password changes and administrator resets invalidate prior JWTs. Password reset tokens are stored as hashes and are never returned by the API.
- Password/Google login and 2FA/password-reset code verification limits: 10 requests/IP/15 min. Registration and forgot-password requests: 5 requests/IP/hour. Reset-token attempts: 10 requests/IP/15 min.

## API reference

Default base URL: `http://localhost:3000`. Paths use the capitalization shown.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/` | Public | Health check |
| `POST` | `/users/Register` | Public, rate-limited | Start email/password registration and send the verification code |
| `POST` | `/users/VerifyRegistrationOtp` | Public, rate-limited | Verify the registration code, create the organization/admin and return a JWT |
| `POST` | `/users/ResendRegistrationOtp` | Public, rate-limited | Resend a pending registration code |
| `POST` | `/users/Login` | Public, rate-limited | Authenticate with email/password; returns JWT or a 2FA challenge |
| `POST` | `/users/Google` | Public, rate-limited | Verify Google ID token; sign in existing user or return organization setup token |
| `POST` | `/users/Google/Register` | Public, rate-limited | Create organization/admin using a verified Google setup token |
| `POST` | `/users/VerifyTwoFactor` | Public, rate-limited | Verify a sign-in code and return JWT |
| `POST` | `/users/ForgotPassword` | Public, rate-limited | Email a password reset code without confirming whether the account exists |
| `POST` | `/users/VerifyResetOtp` | Public, rate-limited | Verify a reset code and receive a short-lived reset token |
| `POST` | `/users/ResetPassword` | Public, rate-limited | Set a new password with a valid reset token |
| `GET` | `/users/Profile` | JWT | Get own profile |
| `PUT` | `/users/UpdateProfile` | JWT | Update own name/profile image |
| `PUT` | `/users/TwoFactor` | JWT | Enable or disable email 2FA for the current user |
| `PUT` | `/users/Organization` | JWT + admin | Update the current organization's name |
| `DELETE` | `/users/Organization` | JWT + admin | Delete the current organization and its related data; body must include the exact `confirmationName` and `confirmationText: "DELETE"` |
| `PUT` | `/users/ChangePassword` | JWT | Change own password; required before using the app for temporary-password accounts |
| `GET` | `/users/Members?page=1&limit=10&sortBy=name&sortOrder=asc` | JWT + admin | List and sort members in the administrator's organization (`name`, `email`, `status`) |
| `POST` | `/users/Members` | JWT + admin | Create a regular member in the administrator's organization |
| `PUT` | `/users/Members/:id` | JWT + admin | Update a member's name/email in the administrator's organization |
| `DELETE` | `/users/Members/:id` | JWT + admin | Delete a regular member in the administrator's organization |
| `PUT` | `/users/Members/:id/ResetPassword` | JWT + admin | Set a new password for a regular member in the administrator's organization |
| `POST` | `/products/Create` | JWT + admin | Create product |
| `GET` | `/products/GetAll?page=1&limit=10&sortBy=name&sortOrder=asc` | JWT | List/search/filter products; sortable fields: `name`, `category`, `price`, `quantity`, `totalValue`, `createdAt` |
| `GET` | `/products/GetById/:id` | JWT | Get product |
| `PUT` | `/products/Update/:id` | JWT + admin | Update product |
| `DELETE` | `/products/Delete/:id` | JWT + admin | Delete product |
| `GET` | `/products/Stats` | JWT | Product and inventory totals |
| `POST` | `/categories/Create` | JWT + admin | Create category |
| `GET` | `/categories/GetAll?page=1&limit=10&sortBy=name&sortOrder=asc` | JWT | List/search categories and inventory totals; sortable fields: `name`, `totalProducts`, `totalStock`, `inventoryValue`, `createdAt` |
| `GET` | `/categories/GetById/:id` | JWT | Get category |
| `PUT` | `/categories/Update/:id` | JWT + admin | Rename category |
| `DELETE` | `/categories/Delete/:id` | JWT + admin | Delete if unused by products |
| `GET` | `/categories/Stats` | JWT | Per-category inventory totals |
| `POST` | `/stock/In` | JWT | Add stock and record movement |
| `POST` | `/stock/Out` | JWT | Remove available stock and record movement |
| `GET` | `/stock/History?page=1&limit=10&sortBy=createdAt&sortOrder=desc` | JWT | Filter/sort movement history by `product`, `type`, `quantity`, `createdBy`, or `createdAt` |
| `GET` | `/stock/LowStock?page=1&limit=10&sortBy=name&sortOrder=asc` | JWT + `stock.low-stock` (or dashboard/report access) | Products with quantity 1–5; sortable by `name`, `price`, `quantity`, or `totalValue` |
| `GET` | `/stock/OutOfStock?page=1&limit=10&sortBy=name&sortOrder=asc` | JWT + `stock.out-of-stock` (or dashboard/report access) | Products with quantity 0; sortable by `name`, `price`, `quantity`, or `totalValue` |
| `GET` | `/stock/Summary?productId=<id>` | JWT + `stock.view` (or statistics/report access) | Product's current and total in/out stock |
| `GET` | `/customers?page=1&limit=10&search=<name-or-phone>&status=pending&sortBy=pendingAmount&sortOrder=desc` | JWT + `customers.view` | Search, filter, sort and page organization customers by `name`, `phone`, `totalUdhaar`, `totalPaid`, `pendingAmount`, `lastTransaction`, or `status` (`sortOrder` and legacy `order` are accepted) |
| `GET` | `/customers/stats` | JWT + `customers.statistics` (or dashboard/report access) | Get organization-scoped customer and Udhaar summary statistics |
| `GET` | `/customers/Udhaar?page=1&limit=100&search=<name-or-phone>` | JWT + `udhaar.view` or `customers.view` | Search and page organization customers for the Udhaar flow |
| `POST` | `/customers` | JWT + `customers.create` | Create a customer (name and phone only) |
| `GET` | `/customers/:id` | JWT + `customers.view` | Get customer details |
| `PUT` | `/customers/:id` | JWT + `customers.update` (`customers.edit` remains compatible) | Update customer name/phone |
| `DELETE` | `/customers/:id` | JWT + `customers.delete` | Archive a customer without outstanding Udhaar |
| `GET` | `/customers/:id/ledger?udhaarSortBy=createdAt&udhaarSortOrder=desc&paymentsSortBy=createdAt&paymentsSortOrder=desc` | JWT + `customers.ledger` | Get customer Udhaar, payment history and outstanding balance with independent history sorting |
| `GET` | `/customers/:id/payments?page=1&limit=10&sortBy=amountCents&sortOrder=desc` | JWT + payment-history permission | Page and sort a customer's payments by `createdAt`, `amountCents`, `method`, or `createdBy` |
| `POST` | `/customers/:id/payments` | JWT + `payments.create` (`udhaar.record-payment` remains compatible) | Record payment against the customer's oldest outstanding Udhaar |

Customer create/update requests require a phone string containing exactly 10 ASCII digits (`0`–`9`). The API derives `organizationId` and `createdBy` from the authenticated user; caller-supplied ownership fields are ignored.
| `POST` | `/sales` | JWT + `sales.create` | Create a fully paid customer-free product sale |
| `GET` | `/sales?page=1&limit=10&search=<text>&startDate=<date>&endDate=<date>&sortBy=createdAt&sortOrder=desc` | JWT + `sales.view` | Search, filter, sort and page organization sales (`createdAt`, `totalCents`, `paidCents`, `quantity`, `paymentMethod`, `soldBy`; legacy `sort` presets remain accepted) |
| `GET` | `/sales/:id` | JWT + `sales.details` | Get sale and payment history |
| `POST` | `/sales/:id/cancel` | JWT + `sales.cancel` | Cancel a sale, restore inventory and keep history |
| `GET` | `/sales/analytics` | JWT + `sales.statistics` (or dashboard/report access) | Sales totals, daily/monthly trend, products, payment methods and sellers |
| `GET` | `/udhaar?page=1&limit=10&paymentStatus=pending&sortBy=createdAt&sortOrder=desc` | JWT + `udhaar.view` | List Udhaar records sorted by `customer`, `createdAt`, `totalCents`, `paidCents`, `pendingCents`, `status`, or `createdBy` |
| `POST` | `/udhaar` | JWT + `udhaar.create` | Create a customer Udhaar; optional product lines create stock-out history |
| `PUT` | `/udhaar/:id` | JWT + `udhaar.update` (`udhaar.edit` remains compatible) | Update the total of a money-only Udhaar; recalculates status while preserving paid amount and payment history |
| `GET` | `/udhaar/:id` | JWT + `udhaar.details` | Get an Udhaar record and its payments |
| `DELETE` | `/udhaar/:id` | JWT + `udhaar.cancel` | Safely cancel an unpaid Udhaar and restore associated stock |
| `GET` | `/udhaar/stats` | JWT + `udhaar.statistics` (or dashboard/report access) | Udhaar, collections and outstanding-customer statistics |
| `POST` | `/udhaar/customers` | JWT + `customers.create` | Create a customer with name and phone |
| `GET` | `/udhaar/customers` | JWT + `udhaar.view` or `customers.view` | List organization-scoped customers |
| `GET` | `/udhaar/customers/:id/ledger` | JWT + `customers.ledger` | Get Udhaar and payment history for a customer |
| `POST` | `/udhaar/customers/:id/payments` | JWT + `payments.create` (`udhaar.record-payment` remains compatible) | Record a payment against outstanding Udhaar records |

Normal sale body:

```json
{
  "items": [{ "productId": "<product ObjectId>", "quantity": 2, "unitPrice": 10.5 }],
  "paymentMethod": "cash"
}
```

Normal sale unit prices default to the current organization product price. A provided positive `unitPrice` is validated and snapshotted. The backend computes the final price, requires full payment, stores the authenticated seller, then atomically creates the sale and payment, decrements product stock and writes source-tagged `StockHistory` out entries. MongoDB transactions require a replica set/Atlas. Sales never create or require a customer; credit transactions belong to the separate Udhaar flow.

Udhaar body:

```json
{
  "customerId": "<customer ObjectId>",
  "totalAmount": 25,
  "paidAmount": 5,
  "paymentMethod": "cash",
  "items": [{ "productId": "<product ObjectId>", "quantity": 2, "unitPrice": 12.5 }]
}
```

Udhaar with product lines uses backend-calculated item totals and transactionally decreases stock. A money-only Udhaar can omit `items` and provide `totalAmount`. The backend records initial and later payments as append-only Payment entries, updates Udhaar status, and allocates later customer payments oldest-first. Cancelling an unpaid record retains it as history and restores any associated stock. Product stock quantities remain the source of truth for sales, Udhaar and stock actions.

Amounts in sale/Udhaar/payment documents and analytics are represented as integer `*Cents` fields; display totals are decimal major-unit amounts. No profit is reported because Product has no cost basis. Payment records are append-only; sale and Udhaar balances are updated in the same transaction as each payment entry.

Sales cancellation is a soft cancellation: `POST /sales/:id/cancel` marks `status: "cancelled"` and records `cancelledAt`/`cancelledBy`, without deleting sale or payment records. Paid sales return `409` and require a separately handled refund. Inventory restoration, source-tagged `StockHistory` `in` entries, and the cancelled status update commit atomically. Cancelled sales are excluded from normal sales lists and analytics.

Organization-admin member endpoints accept a `permissions` array on create/update. Permission IDs are stable, machine-readable keys grouped under `dashboard`, `products`, `categories`, `stock`, `sales`, `udhaar`, `customers`, `payments`, `users`, `profile`, `organization`, and `reports`. The `User.permissions` array is resolved from the authenticated database user on every JWT request; client-supplied identity, role, organization, and permissions are not trusted. Admins bypass permission checks and member/organization management endpoints also enforce the Admin role. New members receive a safe, non-administrative default set. Legacy customer, Udhaar, and sales analytics keys remain compatible; missing permission arrays on older members use the same safe defaults, while an explicitly empty array grants no member permissions.

Business and stock APIs enforce their action-specific permissions server-side. Every business query remains scoped to the authenticated user's `organizationId`. Payment history is returned only when the member has payment-history access, even on analytics/detail responses. No profit is reported because Product has no cost basis.

Example bodies:

```json
// Register
{ "name": "Asha", "email": "asha@example.com", "password": "minimum-8-characters", "organizationName": "Example Store" }

// Create organization member (admin only)
{ "name": "Ravi", "email": "ravi@example.com", "password": "Strong-pass-123!" }

// Admin password reset
{ "password": "New-Strong-123!" }

// Verify registration / forgot-password code
{ "email": "asha@example.com", "otp": "123456" }

// Reset password after OTP verification
{ "token": "<short-lived-reset-token>", "password": "New-Strong-123!" }

// Forgot password
{ "email": "asha@example.com" }

// Change password
{ "currentPassword": "<current-or-temporary-password>", "password": "New-Strong-123!" }

// Create product
{ "name": "Notebook", "price": 50, "quantity": 20, "category": "<category ObjectId>" }

// Stock in/out
{ "productId": "<product ObjectId>", "quantity": 5 }
```

List APIs accept `page` and `limit` (defaults: `1`, `10`; max limit: `100`). Products support `category`, `name`, `sort=price_asc|price_desc`; categories support `search`/`name` and `sort=name_asc|name_desc|newest|oldest`; stock history supports `productId`, `type=in|out`, `search`, `startDate`, `endDate` and `sort=newest|oldest|quantity_asc|quantity_desc`.

Public registration always creates a new organization and its first admin, regardless of any `role` or `organizationId` fields in the request. Authenticated administrators can list, update, activate/deactivate, delete and reset passwords only for regular members in their own organization; created members always receive the `user` role and the administrator's organization ID. Password-reset responses never include a password or reset token.

## Data models

| Model | Main fields and relationships |
|---|---|
| `Organization` | Unique name |
| `User` (member account) | Name, unique email, hidden password hash, role, organization, allowed permissions, profile image, email-verification and password-change/reset state |
| `Category` | Name, organization, creator |
| `Product` | Name, optional JPEG/PNG/WebP image data (up to 300 KB), price, quantity, category, organization, creator |
| `StockHistory` | Product, `in/out` type, quantity, optional source type/ID, organization, creator, timestamps |
| `Customer` | Name, phone, organization, creator |
| `Sale` | Product snapshots, integer-cent totals, payment method, seller, organization |
| `Udhaar` | Customer, optional product snapshots, integer-cent totals and payment status, organization |
| `Payment` | Append-only sale or Udhaar payment event, integer-cent amount, organization, creator |

Each document has MongoDB `_id` (ObjectId). References do not automatically cascade like SQL foreign keys. Category names are unique per organization; products and stock history have organization-oriented indexes. Product deletion does not delete its stock history.

`StockHistory.sourceType`/`sourceId` are optional so existing history entries remain valid. New sale and Udhaar movements are tagged; no data backfill is needed. Customer schema writes only name and phone; existing documents are not destructively migrated.

## Validation, errors and security

- IDs must be 24-character ObjectId strings; pagination values must be positive integers.
- Search is limited to 100 characters and regex characters are escaped.
- Product name is required; price is finite and non-negative; quantity is a non-negative integer; category must belong to the same organization.
- Product image is optional and, when supplied to create/update, must be a base64 data URL containing a JPEG, PNG or WebP image no larger than 300 KB. Image data uses the existing bounded document-storage pattern; existing products without an image remain valid.
- Registration and password changes/resets require a valid-looking email where applicable, non-empty name/organization, and a strong password (8–72 UTF-8 bytes with uppercase, lowercase, number and symbol). OTPs are cryptographically generated, stored as keyed hashes, expire after 10 minutes and are cleared after use.
- JSON request body limit: 1 MB. Mongoose validators run on applicable updates.
- Stock quantity must be a positive integer. Stock changes and history inserts use a transaction; stock-out cannot exceed available quantity.
- Sales validate same-organization products and server-side totals; stock decrement, sale, payment and source-tagged stock-history out movements commit atomically. Udhaar and its optional stock-out, initial payment and subsequent payment updates also commit atomically and cannot exceed the outstanding balance.
- Organization deletion requires an administrator and an exact organization-name plus `DELETE` confirmation; the organization, members and organization-scoped products, categories, stock history, customers, sales, Udhaar and payments are removed in one transaction.
- Passwords use bcryptjs; normal member-account queries omit password. JWT signature, algorithm, expiry and claim shapes are checked.
- CORS allows the deployed frontend, configured origins and local Vite origins outside production. CORS is not authentication.
- Security headers disable `X-Powered-By` and set `nosniff`, frame-denial and referrer policy.
- `.env` secrets must remain private; use HTTPS and a strong JWT secret in production.
- Existing member accounts remain verified by default; new signups explicitly require email verification. No backfill is needed.

| Status | Meaning |
|---|---|
| `400` | Invalid JSON/input/ID/date/pagination or insufficient stock |
| `401` | Missing, invalid or expired token |
| `403` | Disallowed CORS origin or insufficient role |
| `404` | Route/resource not found in the current organization |
| `409` | Duplicate unique value |
| `413` | Request body exceeds 1 MB |
| `429` | Login/registration rate limit reached |
| `500` | Unexpected server/database error |

## Current notes

- Run the backend test suite with `npm test` (Node.js `node:test`).
- JavaScript `.test(...)` in validation code is a regular-expression string check, not the test suite.
- Rate limits use the default in-memory store; use a shared store for multiple server instances.
- No refresh-token/revocation flow, global API rate limit, separate image storage service, or automatic stock-history cleanup is configured.
- Transactions require MongoDB Atlas or a replica set. Backups, monitoring, log retention and secret rotation must be configured for deployment.
