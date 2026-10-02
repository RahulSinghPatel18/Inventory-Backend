const { rateLimit } = require("express-rate-limit");

const createLimiter = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json(options.message);
  }
});

const loginRateLimit = createLimiter(
  15 * 60 * 1000,
  10,
  "Too many login attempts. Please try again in 15 minutes."
);

const registerRateLimit = createLimiter(
  60 * 60 * 1000,
  5,
  "Too many signup attempts. Please try again in an hour."
);

module.exports = { loginRateLimit, registerRateLimit };
