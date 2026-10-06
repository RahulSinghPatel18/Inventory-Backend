const express = require("express");
const productRoutes = require("./routes/productRoutes");
const loggerMiddleware = require("./middleware/loggerMiddleware");
const jwtMiddleware = require("./middleware/jwtMiddleware");
const userRoutes = require("./routes/userRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const stockRoutes = require("./routes/stockRoutes");
const salesRoutes = require("./routes/salesRoutes");
const customerRoutes = require("./routes/customerRoutes");
const udhaarRoutes = require("./routes/udhaarRoutes");
const cors = require("cors");

const app = express();
app.disable("x-powered-by");
const trustProxyHops = process.env.TRUST_PROXY_HOPS;
if (trustProxyHops !== undefined) {
  if (!/^\d+$/.test(trustProxyHops)) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
  }
  app.set("trust proxy", Number(trustProxyHops));
}
const developmentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];
const applicationOrigins = ["https://mystock-hub.netlify.app"];
const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  ...applicationOrigins,
  ...configuredOrigins,
  ...(process.env.NODE_ENV === "production" ? [] : developmentOrigins)
]);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin is not allowed"));
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "1mb" }));

// Mount the product routes
app.use("/products", loggerMiddleware, productRoutes);
app.use("/users", userRoutes);
app.use("/categories", loggerMiddleware, jwtMiddleware, categoryRoutes);
app.use("/stock", loggerMiddleware, jwtMiddleware, stockRoutes);
app.use("/sales", loggerMiddleware, jwtMiddleware, salesRoutes);
app.use("/customers", loggerMiddleware, jwtMiddleware, customerRoutes);
app.use("/udhaar", loggerMiddleware, jwtMiddleware, udhaarRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Backend API is working 🔥🔥"
  });
});

app.use((req, res) => {
  res.status(404).json({ message: "Endpoint not found" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ message: "Invalid JSON request body" });
  }
  if (error.message === "Origin is not allowed") {
    return res.status(403).json({ message: "Origin is not allowed" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large" });
  }

  console.error(`Unhandled request error (${error.name || "Error"})`);
  return res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
