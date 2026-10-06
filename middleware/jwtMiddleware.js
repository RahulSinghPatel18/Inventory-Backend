const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isValidObjectId } = require("../utils/requestValidation");
const { DEFAULT_MEMBER_PERMISSIONS } = require("../utils/permissions");

const jwtMiddleware = async (req, res, next) => {
  const authorization = req.headers.authorization;
  const [scheme, token, extra] = authorization?.split(" ") || [];
  if (scheme !== "Bearer" || !token || extra) {
    return res.status(401).json({
      message: "A valid Bearer token is required"
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });
    if (
      !isValidObjectId(decoded.userId) ||
      !isValidObjectId(decoded.organizationId) ||
      !["admin", "Admin", "user"].includes(decoded.role)
    ) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }

  try {
    const user = await User.findById(decoded.userId)
      .select("organizationId role permissions mustChangePassword isActive +authVersion")
      .lean();

    if (
      !user ||
      user.isActive === false ||
      String(user.organizationId) !== String(decoded.organizationId) ||
      (decoded.authVersion ?? 0) !== (user.authVersion ?? 0) ||
      String(user.role).toLowerCase() !== String(decoded.role).toLowerCase()
    ) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const allowedDuringPasswordChange =
      req.baseUrl === "/users" &&
      ((req.method === "GET" && req.path === "/Profile") ||
        (req.method === "PUT" && req.path === "/ChangePassword"));
    if (user.mustChangePassword && !allowedDuringPasswordChange) {
      return res.status(403).json({
        message: "Change your password before using the application"
      });
    }

    req.user = {
      ...decoded,
      role: user.role,
      permissions: Array.isArray(user.permissions)
        ? user.permissions
        : DEFAULT_MEMBER_PERMISSIONS,
      mustChangePassword: user.mustChangePassword,
      authVersion: user.authVersion ?? 0
    };
    return next();
  } catch (error) {
    console.error(`Authentication check failed (${error.name || "Error"})`);
    return res.status(500).json({ message: "Authentication check failed" });
  }
};

module.exports = jwtMiddleware;