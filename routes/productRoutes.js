const express = require("express");
const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductStats
} = require("../controllers/productController");
const permission = require("../middleware/permissionMiddleware");
const jwtMiddleware = require("../middleware/jwtMiddleware");

const router = express.Router();

router.use(jwtMiddleware);

router.get("/GetAll", permission([
  "products.view", "products.create", "products.update", "products.delete", "stock.view",
  "stock.in", "stock.out", "sales.create", "udhaar.create", "reports.products"
]), getProducts);
router.get("/GetById/:id", permission(["products.details", "reports.products"]), getProductById);
router.post("/Create", permission("products.create"), createProduct);
router.put("/Update/:id", permission("products.update"), updateProduct);
router.delete("/Delete/:id", permission("products.delete"), deleteProduct);
router.get("/Stats", permission(["products.statistics", "dashboard.statistics", "reports.products"]), getProductStats);

module.exports = router;
