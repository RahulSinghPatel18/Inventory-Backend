const express = require("express");
const permission = require("../middleware/permissionMiddleware");
const {
  requestSale, listSales, getSale, cancelSale, analytics
} = require("../controllers/salesController");

const router = express.Router();
router.get("/analytics", permission(["sales.statistics", "analytics.sales", "dashboard.statistics", "reports.sales"]), analytics);
router.post("/", permission("sales.create"), requestSale);
router.get("/", permission("sales.view"), listSales);
router.get("/:id", permission("sales.details"), getSale);
router.post("/:id/cancel", permission("sales.cancel"), cancelSale);
module.exports = router;
