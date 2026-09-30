const express = require("express");
const productRoutes = require("./routes/productRoutes");
const loggerMiddleware = require("./middleware/loggerMiddleware");
const jwtMiddleware = require("./middleware/jwtMiddleware");
const userRoutes = require("./routes/userRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.json({ limit: "10mb" }));

// Mount the product routes
app.use("/products", loggerMiddleware, jwtMiddleware, productRoutes);
app.use("/users", userRoutes);
app.use("/categories", loggerMiddleware, jwtMiddleware, categoryRoutes);

app.get("/", (req, res) => {
res.json({
message: "Backend API is working 🔥🔥"
});
});

module.exports = app;
