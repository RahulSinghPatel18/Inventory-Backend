# InventoryStack Backend

REST API for inventory management, built with Node.js, Express and MongoDB/Mongoose.

## Features

- User registration/login, bcrypt password hashing and JWT authentication.
- Organization-scoped users, categories, products and stock history.
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
   ```

3. Start: `npm run dev` (development) or `npm start`.
4. Check `GET http://localhost:3000/`.

Keep `.env` private and untracked. Add extra exact frontend origins with comma-separated `CORS_ORIGINS`. Behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact trusted hop count.

## Authentication

- Register and login are public. Registration creates a new organization and its first admin.
- Login returns a JWT signed with `HS256`, valid for one day.
- Send the token to protected APIs:

  ```http
  Authorization: Bearer <JWT_TOKEN>
  ```

- Products, categories and stock require JWT. Product create/update/delete additionally require admin; category and stock routes allow any authenticated organization member.
- Data queries are scoped by the token's `organizationId`.
- Login limit: 10 requests/IP/15 min. Registration limit: 5 requests/IP/hour.

## API reference

Default base URL: `http://localhost:3000`. Paths use the capitalization shown.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/` | Public | Health check |
| `POST` | `/users/Register` | Public | Create organization and admin |
| `POST` | `/users/Login` | Public, rate-limited | Login and get JWT |
| `GET` | `/users/Profile` | JWT | Get own profile |
| `PUT` | `/users/UpdateProfile` | JWT | Update own name/profile image |
| `POST` | `/products/Create` | JWT + admin | Create product |
| `GET` | `/products/GetAll` | JWT | List/search/filter products |
| `GET` | `/products/GetById/:id` | JWT | Get product |
| `PUT` | `/products/Update/:id` | JWT + admin | Update product |
| `DELETE` | `/products/Delete/:id` | JWT + admin | Delete product |
| `GET` | `/products/Stats` | JWT | Product and inventory totals |
| `POST` | `/categories/Create` | JWT | Create category |
| `GET` | `/categories/GetAll` | JWT | List/search categories |
| `GET` | `/categories/GetById/:id` | JWT | Get category |
| `PUT` | `/categories/Update/:id` | JWT | Rename category |
| `DELETE` | `/categories/Delete/:id` | JWT | Delete if unused by products |
| `GET` | `/categories/Stats` | JWT | Per-category inventory totals |
| `POST` | `/stock/In` | JWT | Add stock and record movement |
| `POST` | `/stock/Out` | JWT | Remove available stock and record movement |
| `GET` | `/stock/History` | JWT | Filter/sort movement history |
| `GET` | `/stock/LowStock` | JWT | Products with quantity 1–5 |
| `GET` | `/stock/OutOfStock` | JWT | Products with quantity 0 |
| `GET` | `/stock/Summary?productId=<id>` | JWT | Product's current and total in/out stock |

Example bodies:

```json
// Register
{ "name": "Asha", "email": "asha@example.com", "password": "minimum-8-characters", "organizationName": "Example Store" }

// Create product
{ "name": "Notebook", "price": 50, "quantity": 20, "category": "<category ObjectId>" }

// Stock in/out
{ "productId": "<product ObjectId>", "quantity": 5 }
```

List APIs accept `page` and `limit` (defaults: `1`, `10`; max limit: `100`). Products support `category`, `name`, `sort=price_asc|price_desc`; categories support `search`/`name` and `sort=name_asc|name_desc|newest|oldest`; stock history supports `productId`, `type=in|out`, `search`, `startDate`, `endDate` and `sort=newest|oldest|quantity_asc|quantity_desc`.

## Data models

| Model | Main fields and relationships |
|---|---|
| `Organization` | Unique name |
| `User` | Name, unique email, hidden password hash, role, organization, profile image |
| `Category` | Name, organization, creator |
| `Product` | Name, price, quantity, category, organization, creator |
| `StockHistory` | Product, `in/out` type, quantity, organization, creator, timestamps |

Each document has MongoDB `_id` (ObjectId). References do not automatically cascade like SQL foreign keys. Category names are unique per organization; products and stock history have organization-oriented indexes. Product deletion does not delete its stock history.

## Validation, errors and security

- IDs must be 24-character ObjectId strings; pagination values must be positive integers.
- Search is limited to 100 characters and regex characters are escaped.
- Product name is required; price is finite and non-negative; quantity is a non-negative integer; category must belong to the same organization.
- Registration requires a valid-looking email, non-empty name/organization and password of 8–72 UTF-8 bytes. Profile image is a string capped at about 450 KB.
- JSON request body limit: 1 MB. Mongoose validators run on applicable updates.
- Stock quantity must be a positive integer. Stock changes and history inserts use a transaction; stock-out cannot exceed available quantity.
- Passwords use bcryptjs; normal user queries omit password. JWT signature, algorithm, expiry and claim shapes are checked.
- CORS allows the deployed frontend, configured origins and local Vite origins outside production. CORS is not authentication.
- Security headers disable `X-Powered-By` and set `nosniff`, frame-denial and referrer policy.
- `.env` secrets must remain private; use HTTPS and a strong JWT secret in production.

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

- Automated `test/` files were removed in commit `d35acd1`; `package.json` still has an `npm test` script, but no project test files currently exist.
- JavaScript `.test(...)` in validation code is a regular-expression string check, not the test suite.
- Rate limits use the default in-memory store; use a shared store for multiple server instances.
- No refresh-token/revocation flow, global API rate limit, image storage service, or automatic stock-history cleanup is configured.
- Transactions require MongoDB Atlas or a replica set. Backups, monitoring, log retention and secret rotation must be configured for deployment.
