const User = require("../models/User");

const adminMiddleware = async (req, res, next) => {
  try {

    const user = await User.findById(req.user.userId)
      .select("role organizationId")
      .lean();

    if (!user || String(user.organizationId) !== String(req.user.organizationId)) {
      return res.status(401).json({
        message: "Authentication required"
      });
    }

    if (user.role !== "admin" && user.role !== "Admin") {
      return res.status(403).json({
        message: "Access denied. Only for admin "
      });
    }

    next();

  } catch (error) {
    console.error(`Authorization check failed (${error.name || "Error"})`);
    return res.status(500).json({
      message: "Authorization check failed"
    });
  }
};

module.exports = adminMiddleware;