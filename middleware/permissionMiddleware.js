const { DEFAULT_MEMBER_PERMISSIONS } = require("../utils/permissions");
const permissionAliases = Object.freeze({
  "customers.update": ["customers.edit"],
  "udhaar.update": ["udhaar.edit"],
  "payments.create": ["udhaar.record-payment"],
  "payments.history": ["udhaar.payment-history"],
  "sales.statistics": ["analytics.sales"],
  "udhaar.statistics": ["analytics.udhaar"]
});

const permissionMiddleware = (requiredPermissions) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Authentication required" });

  const role = String(req.user.role || "").toLowerCase();
  if (role === "admin") return next();

  const required = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];
  const assigned = Array.isArray(req.user.permissions)
    ? req.user.permissions
    : DEFAULT_MEMBER_PERMISSIONS;
  const hasPermission = required.some((permission) => (
    assigned.includes(permission) ||
    (permissionAliases[permission] || []).some((alias) => assigned.includes(alias))
  ));
  if (hasPermission) return next();

  return res.status(403).json({
    message: `The ${required.join(" or ")} permission is required`
  });
};

module.exports = permissionMiddleware;
