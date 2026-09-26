const express = require("express");
const productRoutes = require("./routes/productRoutes");
const loggerMiddleware = require("./middleware/loggerMiddleware");
const authMiddleware = require("./middleware/authMiddleware");


const app = express();
// Read JsON body data
app.use(express.json());
// Use the logger middleware
// app.use(loggerMiddleware);
// Mount the product routes
app.use("/products",loggerMiddleware, authMiddleware,productRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Backend API is working 🔥🔥"
  });
});


module.exports = app;