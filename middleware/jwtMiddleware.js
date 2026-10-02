const jwt = require("jsonwebtoken");
const { isValidObjectId } = require("../utils/requestValidation");

const jwtMiddleware = (req, res, next) => {
  const authorization = req.headers.authorization;
  const [scheme, token, extra] = authorization?.split(" ") || [];
  if (scheme !== "Bearer" || !token || extra) {
    return res.status(401).json({
      message: "A valid Bearer token is required"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });
    if (
      !isValidObjectId(decoded.userId) ||
      !isValidObjectId(decoded.organizationId) ||
      !["admin", "Admin", "user"].includes(decoded.role)
    ) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
};

module.exports = jwtMiddleware;