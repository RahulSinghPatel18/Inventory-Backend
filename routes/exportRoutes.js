const express = require("express");
const { downloadDataset, downloadFullBackup, downloadReports } = require("../controllers/exportController");
const adminMiddleware = require("../middleware/roleMiddleware");
const permission = require("../middleware/permissionMiddleware");
const { exportRateLimit } = require("../middleware/authRateLimit");

const router = express.Router();
router.use(exportRateLimit);

router.get("/full-backup", adminMiddleware, downloadFullBackup);
router.get("/reports", permission(["reports.products", "reports.stock", "reports.sales", "reports.udhaar"]), downloadReports);
router.get("/products", permission(["products.view", "reports.products"]), downloadDataset("products"));
router.get("/sales", permission(["sales.view", "reports.sales"]), downloadDataset("sales"));
router.get("/stock-history", permission(["stock.history", "reports.stock"]), downloadDataset("stock-history"));
router.get("/customers", permission("customers.view"), downloadDataset("customers"));
router.get("/udhaar", permission("udhaar.view"), downloadDataset("udhaar"));

module.exports = router;
