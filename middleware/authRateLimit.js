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
"Too many sign-in attempts. Please try again in 15 minutes."
);

const registerRateLimit = createLimiter(
60 * 60 * 1000,
5,
"Too many registration attempts. Please try again in 1 hour."
);

const forgotPasswordRateLimit = createLimiter(
60 * 60 * 1000,
5,
"Too many password reset requests. Please try again in 1 hour."
);

const resetPasswordRateLimit = createLimiter(
15 * 60 * 1000,
10,
"Too many password reset attempts. Please try again in 15 minutes."
);

const sendOtpRateLimit = createLimiter(
15 * 60 * 1000,
10,
"Too many verification code requests. Please try again in 15 minutes."
);

const verifyOtpRateLimit = createLimiter(
15 * 60 * 1000,
10,
"Too many verification attempts. Please try again in 15 minutes."
);

module.exports = {
loginRateLimit,
registerRateLimit,
forgotPasswordRateLimit,
resetPasswordRateLimit,
sendOtpRateLimit,
verifyOtpRateLimit
};
