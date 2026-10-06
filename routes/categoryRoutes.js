const express = require("express");
const {
  createCategory,
  getCategories,
  updateCategory,
  getCategoryById,
  deleteCategory,
  getCategoryStats
} = require("../controllers/categoryController");
const permission = require("../middleware/permissionMiddleware");

const router = express.Router();

router.post("/Create", permission("categories.create"), createCategory);
router.get("/GetAll", permission([
  "categories.view", "categories.create", "categories.update", "categories.delete",
  "products.view", "products.create", "products.update", "reports.products"
]), getCategories);
router.get("/GetById/:id", permission(["categories.view", "reports.products"]), getCategoryById);
router.put("/Update/:id", permission("categories.update"), updateCategory);
router.delete("/Delete/:id", permission("categories.delete"), deleteCategory);
router.get("/Stats", permission(["categories.statistics", "dashboard.statistics", "reports.products"]), getCategoryStats);
module.exports = router;