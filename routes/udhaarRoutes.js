const express = require("express");
const permission = require("../middleware/permissionMiddleware");
const {
  createCustomer, listCustomers, getCustomer, updateCustomer, customerLedger, customerPayments,
  listUdhaar, createUdhaar, updateUdhaar, getUdhaar, cancelUdhaar, recordPayment, getUdhaarStats
} = require("../controllers/udhaarController");

const router = express.Router();

router.get("/stats", permission(["udhaar.statistics", "analytics.udhaar", "dashboard.statistics", "reports.udhaar"]), getUdhaarStats);
router.post("/customers", permission("customers.create"), createCustomer);
router.get("/customers", permission(["customers.view", "udhaar.view"]), listCustomers);
router.get("/customers/:id/ledger", permission("customers.ledger"), customerLedger);
router.get("/customers/:id/payments", permission(["payments.history", "udhaar.payment-history"]), customerPayments);
router.get("/customers/:id", permission("customers.view"), getCustomer);
router.put("/customers/:id", permission(["customers.update", "customers.edit"]), updateCustomer);
router.post("/customers/:customerId/payments", permission(["payments.create", "udhaar.record-payment"]), recordPayment);
router.get("/", permission("udhaar.view"), listUdhaar);
router.post("/", permission("udhaar.create"), createUdhaar);
router.put("/:id", permission(["udhaar.update", "udhaar.edit"]), updateUdhaar);
router.get("/:id", permission("udhaar.details"), getUdhaar);
router.delete("/:id", permission("udhaar.cancel"), cancelUdhaar);
router.post("/:id/cancel", permission("udhaar.cancel"), cancelUdhaar);

module.exports = router;
