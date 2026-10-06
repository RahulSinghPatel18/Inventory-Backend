const express = require("express");
const permission = require("../middleware/permissionMiddleware");
const {
  createCustomer, listCustomers, listUdhaarCustomers, getCustomer, updateCustomer, archiveCustomer,
  customerLedger, customerPayments, recordPayment, getCustomerStats
} = require("../controllers/udhaarController");

const router = express.Router();
router.get("/stats", permission(["customers.statistics", "dashboard.statistics", "reports.udhaar"]), getCustomerStats);
router.get("/Udhaar", permission(["customers.view", "udhaar.view"]), listUdhaarCustomers);
router.get("/", permission("customers.view"), listCustomers);
router.post("/", permission("customers.create"), createCustomer);
router.get("/:id/ledger", permission("customers.ledger"), customerLedger);
router.get("/:id/payments", permission(["payments.history", "udhaar.payment-history"]), customerPayments);
router.post("/:id/payments", permission(["payments.create", "udhaar.record-payment"]), recordPayment);
router.get("/:id", permission(["customers.details", "customers.view"]), getCustomer);
router.put("/:id", permission(["customers.update", "customers.edit"]), updateCustomer);
router.delete("/:id", permission("customers.delete"), archiveCustomer);
module.exports = router;
