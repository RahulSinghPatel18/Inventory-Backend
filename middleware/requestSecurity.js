const hasUnsafeKeys = (value) => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasUnsafeKeys);

  return Object.entries(value).some(([key, nestedValue]) => (
    key.startsWith("$") ||
    key.includes(".") ||
    ["__proto__", "prototype", "constructor"].includes(key) ||
    hasUnsafeKeys(nestedValue)
  ));
};

const requestSecurity = (req, res, next) => {
  if (hasUnsafeKeys(req.body) || hasUnsafeKeys(req.query)) {
    return res.status(400).json({ message: "Request contains unsupported field names" });
  }
  return next();
};

module.exports = { hasUnsafeKeys, requestSecurity };
