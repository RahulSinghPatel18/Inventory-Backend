const PERMISSIONS = Object.freeze([
  "dashboard.view", "dashboard.statistics",
  "products.view", "products.details", "products.create", "products.update", "products.delete", "products.statistics",
  "categories.view", "categories.create", "categories.update", "categories.delete", "categories.statistics",
  "stock.view", "stock.in", "stock.out", "stock.history", "stock.low-stock", "stock.out-of-stock", "stock.statistics",
  "sales.view", "sales.create", "sales.details", "sales.cancel", "sales.statistics",
  "udhaar.view", "udhaar.create", "udhaar.details", "udhaar.update", "udhaar.cancel", "udhaar.statistics",
  "customers.view", "customers.details", "customers.create", "customers.update", "customers.delete", "customers.ledger", "customers.statistics",
  "payments.create", "payments.history", "payments.details",
  "users.view", "users.create", "users.update", "users.delete", "users.reset-password", "users.manage-permissions",
  "notifications.view",
  "profile.view", "profile.update", "profile.change-password", "profile.two-factor",
  "organization.view", "organization.update", "organization.delete",
  "reports.view", "reports.sales", "reports.udhaar", "reports.stock", "reports.payments", "reports.products", "reports.users",
  // Keep existing keys valid so saved member permissions continue to work.
  "customers.edit", "udhaar.edit", "udhaar.record-payment", "udhaar.payment-history",
  "analytics.sales", "analytics.udhaar", "analytics.profit"
]);

const PERMISSION_SET = new Set(PERMISSIONS);
const DEFAULT_MEMBER_PERMISSIONS = Object.freeze([
  "dashboard.view",
  "products.view",
  "products.details",
  "stock.view",
  "sales.view",
  "udhaar.view",
  "customers.view",
  "notifications.view",
  "profile.view",
  "profile.update",
  "profile.change-password",
  "profile.two-factor"
]);

module.exports = { PERMISSIONS, PERMISSION_SET, DEFAULT_MEMBER_PERMISSIONS };
