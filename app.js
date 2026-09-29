const express = require("express");
const productRoutes = require("./routes/productRoutes");
const loggerMiddleware = require("./middleware/loggerMiddleware");
const jwtMiddleware = require("./middleware/jwtMiddleware");
const userRoutes = require("./routes/userRoutes");
const cors = require("cors");


const app = express();

app.use(
  cors({
    origin: "http://localhost:5173"
  })
);

app.use(express.json());
// Read JsON body data
app.use(express.json());

// Mount the product routes
app.use("/products",loggerMiddleware, jwtMiddleware,productRoutes);
app.use("/users", userRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "Backend API is working 🔥🔥"
  });
});


module.exports = app;