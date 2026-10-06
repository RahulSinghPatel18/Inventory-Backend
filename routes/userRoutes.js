const express = require("express");
const {
  registerUser,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  loginUser,
  googleLogin,
  registerGoogleOrganization,
  verifyTwoFactor,
  getProfile,
  updateTwoFactor,
  updateProfile,
  updateOrganization,
  deleteOrganization,
  getOrganizationUsers,
  createOrganizationUser,
  updateOrganizationUser,
  deleteOrganizationUser,
  resetOrganizationUserPassword,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  changePassword
} = require("../controllers/userController");
const jwtMiddleware = require("../middleware/jwtMiddleware");
const adminMiddleware = require("../middleware/roleMiddleware");
const permission = require("../middleware/permissionMiddleware");
const {
  loginRateLimit,
  registerRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
  sendOtpRateLimit,
  verifyOtpRateLimit
} = require("../middleware/authRateLimit");

const router = express.Router();


router.post("/Register", registerRateLimit, registerUser);
router.post("/VerifyRegistrationOtp", verifyOtpRateLimit, verifyRegistrationOtp);
router.post("/ResendRegistrationOtp", sendOtpRateLimit, resendRegistrationOtp);
router.post("/Login", loginRateLimit, loginUser);
router.post("/Google", loginRateLimit, googleLogin);
router.post("/Google/Register", registerRateLimit, registerGoogleOrganization);
router.post("/VerifyTwoFactor", verifyOtpRateLimit, verifyTwoFactor);
router.post("/ForgotPassword", forgotPasswordRateLimit, forgotPassword);
router.post("/VerifyResetOtp", verifyOtpRateLimit, verifyResetOtp);
router.post("/ResetPassword", resetPasswordRateLimit, resetPassword);
router.get("/Profile", jwtMiddleware, permission(["profile.view", "organization.view"]), getProfile);
router.put("/UpdateProfile", jwtMiddleware, permission("profile.update"), updateProfile);
router.put("/TwoFactor", jwtMiddleware, permission("profile.two-factor"), updateTwoFactor);
router.put("/Organization", jwtMiddleware, permission("organization.update"), adminMiddleware, updateOrganization);
router.delete("/Organization", jwtMiddleware, permission("organization.delete"), adminMiddleware, deleteOrganization);
router.put("/ChangePassword", jwtMiddleware, permission("profile.change-password"), changePassword);
router.get("/Members", jwtMiddleware, permission("users.view"), adminMiddleware, getOrganizationUsers);
router.post("/Members", jwtMiddleware, permission("users.create"), adminMiddleware, createOrganizationUser);
router.put("/Members/:id", jwtMiddleware, permission(["users.update", "users.manage-permissions"]), adminMiddleware, updateOrganizationUser);
router.delete("/Members/:id", jwtMiddleware, permission("users.delete"), adminMiddleware, deleteOrganizationUser);
router.put(
  "/Members/:id/ResetPassword",
  jwtMiddleware,
  permission("users.reset-password"),
  adminMiddleware,
  resetOrganizationUserPassword
);

module.exports = router;