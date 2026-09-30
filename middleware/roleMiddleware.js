const User = require("../models/User");

const adminMiddleware = async (req, res, next) => {
  try {

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    if (user.role !== "admin" && user.role !== "Admin") {
      return res.status(403).json({
        message: "Access denied. Only for admin "
      });
    }

    next();

  } catch (error) {

    res.status(500).json({
      message: "Authorization failed",
      error: error.message
    });

  }
};

module.exports = adminMiddleware;