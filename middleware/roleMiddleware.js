const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  if (req.user.role !== "admin" && req.user.role !== "Admin") {
    return res.status(403).json({ message: "Access denied. Admin role required." });
  }

  return next();
};

module.exports = adminMiddleware;