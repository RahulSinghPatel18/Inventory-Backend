const express = require("express");
const { stockIn,stockOut,getStockHistory,getLowStock,getOutOfStock, getStockSummary } = require("../controllers/stockController");
const permission = require("../middleware/permissionMiddleware");

const router = express.Router();

router.post("/In", permission("stock.in"), stockIn);
router.post("/Out", permission("stock.out"), stockOut);
router.get("/History", permission(["stock.history", "reports.stock"]), getStockHistory);
router.get("/LowStock", permission(["stock.low-stock", "dashboard.statistics", "reports.stock"]), getLowStock);
router.get("/OutOfStock", permission(["stock.out-of-stock", "dashboard.statistics", "reports.stock"]), getOutOfStock);
router.get("/Summary", permission(["stock.view", "stock.statistics", "dashboard.statistics", "reports.stock"]), getStockSummary);
module.exports = router;