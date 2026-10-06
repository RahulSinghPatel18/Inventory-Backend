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
2 * 60 * 1000,
100,
"Too many login attempts. Please try again in 2 minute."
);

const registerRateLimit = createLimiter(
5 * 60 * 1000,
100,
"Too many signup attempts. Please try again in 5 minutes."
);

const forgotPasswordRateLimit = createLimiter(
5 * 60 * 1000,
100,
"Too many password reset requests. Please try again in 5 minutes."
);

const resetPasswordRateLimit = createLimiter(
2 * 60 * 1000,
100,
"Too many password reset attempts. Please try again in 2 minute."
);

const sendOtpRateLimit = createLimiter(
5 * 60 * 1000,
100,
"Too many verification code requests. Please try again in 5 minutes."
);

const verifyOtpRateLimit = createLimiter(
2 * 60 * 1000,
100,
"Too many verification attempts. Please try again in 2 minute."
);

module.exports = {
loginRateLimit,
registerRateLimit,
forgotPasswordRateLimit,
resetPasswordRateLimit,
sendOtpRateLimit,
verifyOtpRateLimit
};
