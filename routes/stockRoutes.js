const express = require("express");
const { stockIn,stockOut,getStockHistory,getLowStock,getOutOfStock, getStockSummary } = require("../controllers/stockController");

const router = express.Router();

router.post("/In", stockIn);
router.post("/Out", stockOut);
router.get("/History", getStockHistory);
router.get("/LowStock", getLowStock);
router.get("/OutOfStock", getOutOfStock);
router.get("/Summary", getStockSummary);
module.exports = router;