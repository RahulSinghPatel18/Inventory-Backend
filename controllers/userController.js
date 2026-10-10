const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { google } = require("googleapis");
const User = require("../models/User");
const Organization = require("../models/Organization");
const Category = require("../models/Category");
const Product = require("../models/Product");
const StockHistory = require("../models/StockHistory");
const Customer = require("../models/Customer");
const Sale = require("../models/Sale");
const Udhaar = require("../models/Udhaar");
const Payment = require("../models/Payment");
const Notification = require("../models/Notification");
const handleControllerError = require("../utils/controllerError");
const { sendOtpEmail } = require("../utils/emailService");
const { PERMISSION_SET, DEFAULT_MEMBER_PERMISSIONS } = require("../utils/permissions");
const {
  isNonEmptyString,
  isValidObjectId,
  parsePagination
} = require("../utils/requestValidation");

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const OTP_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const MAX_PENDING_REGISTRATIONS = 10_000;
const OTP_GENERIC_MESSAGE = "If the account is eligible, a verification code will be sent.";
const pendingRegistrations = new Map();
const isValidPassword = (password) => (
  typeof password === "string" &&
  password.length >= 8 &&
  Buffer.byteLength(password, "utf8") <= 72 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password)
);
const hashResetToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const createOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
const hashOtp = (otp) => crypto
  .createHmac("sha256", process.env.JWT_SECRET)
  .update(otp)
  .digest("hex");
const isValidOtpRequest = (email, otp) => (
  isNonEmptyString(email) &&
  isValidEmail(email.trim()) &&
  typeof otp === "string" &&
  /^\d{6}$/.test(otp)
);
const removeExpiredRegistrations = (now = Date.now()) => {
  for (const [email, registration] of pendingRegistrations) {
    if (registration.registrationExpiresAt <= now && !registration.verifying && !registration.sending) {
      pendingRegistrations.delete(email);
    }
  }
};
const createAccessToken = (user) => jwt.sign({
  userId: user._id,
  role: user.role,
  organizationId: user.organizationId,
  authVersion: user.authVersion || 0
}, process.env.JWT_SECRET, {
  expiresIn: "1d",
  algorithm: "HS256"
});
const isTwoFactorEnabled = (user) => (
  user.twoFactorEnabled ?? String(user.role).toLowerCase() === "admin"
);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const passwordResetMessage = "If the email is registered, a verification code will be sent.";
const emailFilter = (email) => ({
  $regex: `^${escapeRegex(email.trim())}$`,
  $options: "i"
});

const createLoginUser = (user, organization) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  organizationId: user.organizationId,
  organizationName: organization?.name || "",
  role: user.role,
  permissions: Array.isArray(user.permissions) ? user.permissions : DEFAULT_MEMBER_PERMISSIONS,
  profileImage: user.profileImage,
  mustChangePassword: user.mustChangePassword,
  hasPassword: Boolean(user.password),
  twoFactorEnabled: isTwoFactorEnabled(user)
});

const createSessionResponse = async (user, res, message) => {
  const organization = await Organization.findById(user.organizationId)
    .select("name")
    .lean();
  return res.json({
    message,
    token: createAccessToken(user),
    user: createLoginUser(user, organization)
  });
};

const sendTwoFactorChallenge = async (user, res) => {
  const otp = createOtp();
  const otpHash = hashOtp(otp);
  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + OTP_TTL_MS);
  const update = await User.updateOne(
    {
      _id: user._id,
      $or: [
        { twoFactorOtpSentAt: { $exists: false } },
        { twoFactorOtpSentAt: { $lte: new Date(sentAt.getTime() - OTP_RESEND_COOLDOWN_MS) } }
      ]
    },
    {
      $set: {
        twoFactorOtpHash: otpHash,
        twoFactorOtpExpiresAt: expiresAt,
        twoFactorOtpAttempts: 0,
        twoFactorOtpSentAt: sentAt
      }
    }
  );
  if (!update.modifiedCount) {
    return res.status(429).json({
      message: "Please wait before requesting another sign-in code."
    });
  }

  try {
    await sendOtpEmail(user.email, otp, "twoFactor");
  } catch (error) {
    await User.updateOne(
      { _id: user._id, twoFactorOtpHash: otpHash },
      {
        $unset: {
          twoFactorOtpHash: 1,
          twoFactorOtpExpiresAt: 1,
          twoFactorOtpAttempts: 1,
          twoFactorOtpSentAt: 1
        }
      }
    );
    console.error(`Two-factor email delivery failed (${error.name || "Error"})`);
    return res.status(503).json({ message: "A verification code could not be sent. Please try again." });
  }

  return res.json({
    message: "Verification code sent",
    requiresTwoFactor: true,
    challengeToken: jwt.sign(
      { userId: user._id, authVersion: user.authVersion || 0, purpose: "twoFactor" },
      process.env.JWT_SECRET,
      { expiresIn: "10m", algorithm: "HS256" }
    )
  });
};

const sendAuthenticatedSession = async (user, res, message) => {
  if (isTwoFactorEnabled(user)) return sendTwoFactorChallenge(user, res);
  return createSessionResponse(user, res, message);
};

const incrementOtpAttempts = (email, attemptsField, otpHashField, expiresField) => (
  User.findOneAndUpdate(
    {
      email: emailFilter(email),
      [otpHashField]: { $exists: true },
      [expiresField]: { $gt: new Date() },
      [attemptsField]: { $lt: OTP_MAX_ATTEMPTS }
    },
    { $inc: { [attemptsField]: 1 } },
    { returnDocument: "after" }
  ).select(attemptsField).lean()
);

const clearOtp = async (userId, otpHashField, expiresField, attemptsField, sentAtField, otpHash) => {
  await User.updateOne(
    { _id: userId, [otpHashField]: otpHash },
    {
      $unset: {
        [otpHashField]: 1,
        [expiresField]: 1,
        [attemptsField]: 1,
        [sentAtField]: 1
      }
    }
  );
};

const getOrganizationUsers = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (!pagination) {
      return res.status(400).json({
        message: "Page and limit must be valid positive integers (limit up to 100)"
      });
    }

    const sortBy = req.query.sortBy || "name";
    const sortOrder = req.query.sortOrder || "asc";
    const sortFields = {
      name: "name",
      email: "email",
      status: "isActive"
    };
    if (
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string" ||
      !Object.hasOwn(sortFields, sortBy) ||
      !["asc", "desc"].includes(sortOrder)
    ) {
      return res.status(400).json({ message: "Invalid member sorting options" });
    }

    const filter = {
      organizationId: req.user.organizationId,
      role: "user"
    };
    const [totalUsers, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("_id name email role organizationId permissions mustChangePassword isActive")
        .sort({ [sortFields[sortBy]]: sortOrder === "asc" ? 1 : -1, _id: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean()
    ]);
    const totalPages = Math.ceil(totalUsers / pagination.limit);

    return res.json({
      message: "Organization members fetched successfully",
      page: pagination.page,
      limit: pagination.limit,
      totalUsers,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1,
      users: users.map((user) => ({
        ...user,
        permissions: Array.isArray(user.permissions)
          ? user.permissions
          : DEFAULT_MEMBER_PERMISSIONS
      }))
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch organization members");
  }
};

const createOrganizationUser = async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body || {};
    if (
      !isNonEmptyString(name) ||
      !isNonEmptyString(email) ||
      !isValidEmail(email.trim()) ||
      !isValidPassword(password)
    ) {
      return res.status(400).json({
        message: "Enter a name, valid email and a strong password (8-72 bytes)"
      });
    }
    if (
      permissions !== undefined &&
      (!Array.isArray(permissions) || permissions.some((permission) => !PERMISSION_SET.has(permission)))
    ) {
      return res.status(400).json({ message: "permissions must contain only supported permission names" });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (await User.exists({ email: cleanEmail })) {
      return res.status(409).json({ message: "Member already exists" });
    }

    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: await bcrypt.hash(password, 10),
      role: "user",
      permissions: [...new Set(permissions ?? DEFAULT_MEMBER_PERMISSIONS)],
      organizationId: req.user.organizationId,
      mustChangePassword: true,
      emailVerified: true,
      isActive: true
    });

    return res.status(201).json({
      message: "Organization member created successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        organizationId: user.organizationId,
        mustChangePassword: user.mustChangePassword,
        isActive: user.isActive
      }
    });
  } catch (error) {
    return handleControllerError(res, error, "Organization member creation failed");
  }
};

const registerUser = async (req, res) => {
  let registrationReservation;
  try {
    const { name, email, password, organizationName } = req.body || {};
    if (
      !isNonEmptyString(name) ||
      !isNonEmptyString(email) ||
      !isValidEmail(email.trim()) ||
      !isValidPassword(password) ||
      !isNonEmptyString(organizationName)
    ) {
      return res.status(400).json({
        message: "Enter a name, valid email, strong password and organization name"
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanOrganizationName = organizationName.trim();
    const [existingUser, existingOrganization] = await Promise.all([
      User.exists({ email: { $regex: `^${escapeRegex(cleanEmail)}$`, $options: "i" } }),
      Organization.exists({ name: cleanOrganizationName })
    ]);

    if (existingUser) {
      return res.status(400).json({ message: "Member account already exists" });
    }

    if (existingOrganization) {
      return res.status(409).json({
        message: "Organization already exists. Ask its administrator to invite you."
      });
    }

    removeExpiredRegistrations();
    if (pendingRegistrations.has(cleanEmail)) {
      return res.status(409).json({ message: "A verification code is already pending for this email." });
    }
    if (pendingRegistrations.size >= MAX_PENDING_REGISTRATIONS) {
      return res.status(503).json({ message: "Registration verification is temporarily unavailable. Try again later." });
    }

    registrationReservation = {
      email: cleanEmail,
      sending: true,
      verifying: false,
      registrationExpiresAt: Date.now() + REGISTRATION_TTL_MS
    };
    pendingRegistrations.set(cleanEmail, registrationReservation);
    const otp = createOtp();
    const registration = {
      name: cleanName,
      email: cleanEmail,
      password: await bcrypt.hash(password, 10),
      organizationName: cleanOrganizationName,
      otpHash: hashOtp(otp),
      expiresAt: Date.now() + OTP_TTL_MS,
      registrationExpiresAt: Date.now() + REGISTRATION_TTL_MS,
      attempts: 0,
      sentAt: Date.now(),
      sending: true,
      verifying: false
    };
    pendingRegistrations.set(cleanEmail, registration);
    registrationReservation = registration;
    try {
      await sendOtpEmail(cleanEmail, otp, "registration");
    } catch (error) {
      if (pendingRegistrations.get(cleanEmail) === registration) {
        pendingRegistrations.delete(cleanEmail);
      }
      console.error(`Registration verification email delivery failed (${error.name || "Error"})`);
      return res.status(503).json({
        message: "The verification email could not be sent. No account was created; please try again."
      });
    }
    registration.sending = false;

    return res.status(201).json({
      message: "Verification code sent. Verify your email to complete registration.",
      emailVerificationRequired: true
    });
  } catch (error) {
    if (registrationReservation) {
      const email = registrationReservation.email;
      if (email && pendingRegistrations.get(email) === registrationReservation) {
        pendingRegistrations.delete(email);
      }
    }
    return handleControllerError(res, error, "Registration failed");
  }
};

const verifyRegistrationOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  if (!isValidOtpRequest(email, otp)) {
    return res.status(400).json({ message: "Enter a valid email address and 6-digit code" });
  }

  const cleanEmail = email.trim().toLowerCase();
  removeExpiredRegistrations();
  const registration = pendingRegistrations.get(cleanEmail);
  if (!registration || registration.expiresAt <= Date.now() || registration.sending) {
    return res.status(400).json({ message: "Verification code is invalid or expired" });
  }
  if (registration.verifying) {
    return res.status(409).json({ message: "Registration verification is already in progress." });
  }
  if (registration.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ message: "Verification code is invalid or expired" });
  }

  const providedHash = Buffer.from(hashOtp(otp), "hex");
  const expectedHash = Buffer.from(registration.otpHash, "hex");
  if (!crypto.timingSafeEqual(providedHash, expectedHash)) {
    registration.attempts += 1;
    return res.status(registration.attempts >= OTP_MAX_ATTEMPTS ? 429 : 400)
      .json({ message: "Verification code is invalid or expired" });
  }

  registration.verifying = true;
  let session;
  let organization;
  let user;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      [organization] = await Organization.create([{
        name: registration.organizationName
      }], { session });
      [user] = await User.create([{
        name: registration.name,
        email: registration.email,
        password: registration.password,
        organizationId: organization._id,
        role: "admin",
        emailVerified: true
      }], { session });
    });
    pendingRegistrations.delete(cleanEmail);
  } catch (error) {
    if (error?.code === 11000) {
      pendingRegistrations.delete(cleanEmail);
      return res.status(409).json({
        message: "An account or organization with those details already exists."
      });
    }
    registration.verifying = false;
    return handleControllerError(res, error, "Email verification failed");
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (error) {
        console.error(`Registration database session cleanup failed (${error.name || "Error"})`);
      }
    }
  }

  return res.json({
    message: "Email verified and registration complete.",
    token: createAccessToken(user),
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      organizationId: organization._id,
      organizationName: organization.name,
      role: user.role,
      permissions: user.permissions || [],
      profileImage: user.profileImage,
      mustChangePassword: user.mustChangePassword,
      hasPassword: true,
      twoFactorEnabled: isTwoFactorEnabled(user)
    }
  });
};

const resendRegistrationOtp = async (req, res) => {
  const { email } = req.body || {};
  if (!isNonEmptyString(email) || !isValidEmail(email.trim())) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    removeExpiredRegistrations();
    const registration = pendingRegistrations.get(cleanEmail);
    if (
      registration &&
      !registration.sending &&
      !registration.verifying &&
      Date.now() - registration.sentAt >= OTP_RESEND_COOLDOWN_MS
    ) {
      const otp = createOtp();
      const sentAt = Date.now();
      registration.sending = true;
      try {
        await sendOtpEmail(cleanEmail, otp, "registration");
        registration.otpHash = hashOtp(otp);
        registration.expiresAt = sentAt + OTP_TTL_MS;
        registration.attempts = 0;
        registration.sentAt = sentAt;
      } catch (error) {
        console.error(`Registration verification email delivery failed (${error.name || "Error"})`);
        return res.status(503).json({
          message: "The verification email could not be sent. Please try again."
        });
      } finally {
        registration.sending = false;
      }
    }
    return res.json({ message: OTP_GENERIC_MESSAGE });
  } catch (error) {
    return handleControllerError(res, error, "Failed to resend verification code");
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const user = await User.findOne({
      email: { $regex: `^${escapeRegex(email.trim())}$`, $options: "i" }
    }).select("+password +authVersion");
    if (
      !user ||
      user.isActive === false ||
      !user.password ||
      !(await bcrypt.compare(password, user.password))
    ) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }
    return await sendAuthenticatedSession(user, res, "Login successful");
  } catch (error) {
    return handleControllerError(res, error, "Login failed");
  }
};

const resendTwoFactor = async (req, res) => {
  const { challengeToken } = req.body || {};
  if (typeof challengeToken !== "string" || !challengeToken) {
    return res.status(400).json({ message: "A valid sign-in verification session is required" });
  }

  try {
    const challenge = jwt.verify(challengeToken, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });
    if (challenge.purpose !== "twoFactor" || !isValidObjectId(challenge.userId)) {
      return res.status(401).json({ message: "Verification session is invalid or expired" });
    }

    const challengeAuthVersion = Number.isSafeInteger(challenge.authVersion) ? challenge.authVersion : 0;
    const user = await User.findOne({
      _id: challenge.userId,
      isActive: { $ne: false },
      $or: [
        { authVersion: challengeAuthVersion },
        ...(challengeAuthVersion === 0 ? [{ authVersion: { $exists: false } }] : [])
      ],
      twoFactorOtpHash: { $exists: true }
    }).select("+authVersion");
    if (!user || !isTwoFactorEnabled(user)) {
      return res.status(401).json({ message: "Verification session is invalid or expired. Sign in again." });
    }

    return await sendTwoFactorChallenge(user, res);
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Verification session is invalid or expired" });
    }
    return handleControllerError(res, error, "Failed to resend sign-in verification code");
  }
};

const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (typeof credential !== "string" || !credential) {
      return res.status(400).json({ message: "Google credential is required" });
    }
    if (!process.env.GMAIL_CLIENT_ID) {
      return res.status(503).json({ message: "Google sign-in is not configured" });
    }

    let ticket;
    try {
      const client = new google.auth.OAuth2();
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GMAIL_CLIENT_ID
      });
    } catch {
      return res.status(401).json({ message: "Google credential is invalid or expired" });
    }
    const payload = ticket.getPayload();
    if (
      !payload?.sub ||
      payload.email_verified !== true ||
      !isValidEmail(payload.email || "")
    ) {
      return res.status(401).json({ message: "Google could not verify this account" });
    }

    const email = payload.email.trim().toLowerCase();
    let user = await User.findOne({ googleId: payload.sub })
      .select("+googleId +authVersion +password");
    if (!user) {
      user = await User.findOne({
        email: { $regex: `^${escapeRegex(email)}$`, $options: "i" }
      }).select("+googleId +authVersion +password");
    }

    if (!user) {
      return res.json({
        message: "Google verified. Create your organization to continue.",
        requiresOrganization: true,
        registrationToken: jwt.sign({
          purpose: "googleRegistration",
          googleId: payload.sub,
          email,
          name: payload.name?.trim() || email.split("@")[0]
        }, process.env.JWT_SECRET, {
          expiresIn: "10m",
          algorithm: "HS256"
        })
      });
    }

    if (user.googleId && user.googleId !== payload.sub) {
      return res.status(409).json({
        message: "This email is linked to a different Google account."
      });
    }
    if (user.isActive === false) {
      return res.status(401).json({ message: "This account is inactive." });
    }
    if (!user.googleId) {
      user = await User.findOneAndUpdate(
        { _id: user._id, $or: [{ googleId: { $exists: false } }, { googleId: payload.sub }] },
        { $set: { googleId: payload.sub, emailVerified: true } },
        { returnDocument: "after" }
      ).select("+googleId +authVersion +password");
      if (!user) {
        return res.status(409).json({ message: "This Google account could not be linked." });
      }
    }

    return await createSessionResponse(user, res, "Google sign-in successful");
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "An account or organization with those details already exists."
      });
    }
    if (error?.name === "OAuth2ClientError" || error?.name === "GaxiosError") {
      return res.status(401).json({ message: "Google credential is invalid or expired" });
    }
    return handleControllerError(res, error, "Google sign-in failed");
  }
};

const registerGoogleOrganization = async (req, res) => {
  const { registrationToken, organizationName } = req.body || {};
  if (
    typeof registrationToken !== "string" ||
    !isNonEmptyString(organizationName) ||
    organizationName.trim().length > 120
  ) {
    return res.status(400).json({ message: "A valid Google registration and organization name are required." });
  }

  try {
    const identity = jwt.verify(registrationToken, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });
    if (
      identity.purpose !== "googleRegistration" ||
      typeof identity.googleId !== "string" ||
      !identity.googleId ||
      !isValidEmail(identity.email || "")
    ) {
      return res.status(401).json({ message: "Google registration is invalid or expired." });
    }

    const email = identity.email.trim().toLowerCase();
    const findExistingAccount = async () => {
      let existing = await User.findOne({ googleId: identity.googleId })
        .select("+googleId +authVersion +password");
      if (!existing) {
        existing = await User.findOne({
          email: { $regex: `^${escapeRegex(email)}$`, $options: "i" }
        }).select("+googleId +authVersion +password");
      }
      return existing;
    };

    let user = await findExistingAccount();
    if (user) {
      if (user.isActive === false) {
        return res.status(401).json({ message: "This account is inactive." });
      }
      if (user.googleId && user.googleId !== identity.googleId) {
        return res.status(409).json({ message: "This email is linked to a different Google account." });
      }
      if (!user.googleId) {
        user = await User.findOneAndUpdate(
          { _id: user._id, $or: [{ googleId: { $exists: false } }, { googleId: identity.googleId }] },
          { $set: { googleId: identity.googleId, emailVerified: true } },
          { returnDocument: "after" }
        ).select("+googleId +authVersion +password");
      }
      if (!user) {
        return res.status(409).json({ message: "This Google account could not be linked." });
      }
      return await createSessionResponse(user, res, "Google sign-in successful");
    }

    let session;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const [organization] = await Organization.create([{
          name: organizationName.trim()
        }], { session });
        [user] = await User.create([{
          name: identity.name,
          email,
          googleId: identity.googleId,
          organizationId: organization._id,
          role: "admin",
          emailVerified: true
        }], { session });
      });
    } catch (error) {
      if (error?.code === 11000) {
        const existing = await findExistingAccount();
        if (existing?.isActive !== false && existing.googleId === identity.googleId) {
          return await createSessionResponse(existing, res, "Google sign-in successful");
        }
        if (existing && !existing.googleId && existing.isActive !== false) {
          const linkedUser = await User.findOneAndUpdate(
            { _id: existing._id, $or: [{ googleId: { $exists: false } }, { googleId: identity.googleId }] },
            { $set: { googleId: identity.googleId, emailVerified: true } },
            { returnDocument: "after" }
          ).select("+googleId +authVersion +password");
          if (linkedUser) {
            return await createSessionResponse(linkedUser, res, "Google sign-in successful");
          }
        }
        return res.status(409).json({
          message: "An account or organization with those details already exists."
        });
      }
      throw error;
    } finally {
      if (session) await session.endSession();
    }

    return await createSessionResponse(user, res, "Google registration successful");
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Google registration is invalid or expired." });
    }
    return handleControllerError(res, error, "Google organization setup failed");
  }
};

const verifyTwoFactor = async (req, res) => {
  const { challengeToken, otp } = req.body || {};
  if (
    typeof challengeToken !== "string" ||
    typeof otp !== "string" ||
    !/^\d{6}$/.test(otp)
  ) {
    return res.status(400).json({ message: "Enter a valid 6-digit verification code" });
  }

  try {
    const challenge = jwt.verify(challengeToken, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });
    if (challenge.purpose !== "twoFactor" || !isValidObjectId(challenge.userId)) {
      return res.status(401).json({ message: "Verification session is invalid or expired" });
    }
    const challengeAuthVersion = Number.isSafeInteger(challenge.authVersion) ? challenge.authVersion : 0;

    const expectedOtpHash = hashOtp(otp);
    const user = await User.findOneAndUpdate(
      {
        _id: challenge.userId,
        isActive: { $ne: false },
        $or: [
          { authVersion: challengeAuthVersion },
          ...(challengeAuthVersion === 0 ? [{ authVersion: { $exists: false } }] : [])
        ],
        twoFactorOtpHash: expectedOtpHash,
        twoFactorOtpExpiresAt: { $gt: new Date() },
        twoFactorOtpAttempts: { $lt: OTP_MAX_ATTEMPTS }
      },
      {
        $unset: {
          twoFactorOtpHash: 1,
          twoFactorOtpExpiresAt: 1,
          twoFactorOtpAttempts: 1,
          twoFactorOtpSentAt: 1
        }
      },
      { returnDocument: "after" }
    ).select("+authVersion +twoFactorOtpHash +password");

    if (!user) {
      const attempt = await User.findOneAndUpdate(
        {
          _id: challenge.userId,
          $or: [
            { authVersion: challengeAuthVersion },
            ...(challengeAuthVersion === 0 ? [{ authVersion: { $exists: false } }] : [])
          ],
          twoFactorOtpHash: { $exists: true },
          twoFactorOtpExpiresAt: { $gt: new Date() },
          twoFactorOtpAttempts: { $lt: OTP_MAX_ATTEMPTS }
        },
        { $inc: { twoFactorOtpAttempts: 1 } },
        { returnDocument: "after" }
      ).select("+twoFactorOtpAttempts");
      return res.status(attempt?.twoFactorOtpAttempts >= OTP_MAX_ATTEMPTS ? 429 : 400)
        .json({ message: "Verification code is invalid or expired" });
    }
    if (!isTwoFactorEnabled(user)) {
      return res.status(401).json({ message: "Two-factor verification is no longer enabled." });
    }

    const organization = await Organization.findById(user.organizationId)
      .select("name")
      .lean();
    return res.json({
      message: "Login successful",
      token: createAccessToken(user),
      user: createLoginUser(user, organization)
    });
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Verification session is invalid or expired" });
    }
    return handleControllerError(res, error, "Two-factor verification failed");
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select("+password +googleId")
      .populate("organizationId", "name");

    if (!user) {
      return res.status(404).json({ message: "Member account not found" });
    }

    const profile = user.toObject();
    const hasPassword = Boolean(profile.password);
    delete profile.password;
    delete profile.googleId;
    const organization = profile.organizationId;
    return res.json({
      message: "Profile fetched successfully",
      user: {
        ...profile,
        hasPassword,
        organizationId: organization?._id || "",
        organizationName: organization?.name || "",
        permissions: Array.isArray(profile.permissions) ? profile.permissions : DEFAULT_MEMBER_PERMISSIONS,
        twoFactorEnabled: isTwoFactorEnabled(user)
      }
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch profile");
  }
};

const updateTwoFactor = async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled must be a boolean" });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      {
        $set: { twoFactorEnabled: enabled },
        ...(!enabled ? {
          $unset: {
            twoFactorOtpHash: 1,
            twoFactorOtpExpiresAt: 1,
            twoFactorOtpAttempts: 1,
            twoFactorOtpSentAt: 1
          }
        } : {})
      },
      { returnDocument: "after", runValidators: true }
    ).select("_id twoFactorEnabled");

    if (!user) {
      return res.status(404).json({ message: "Member account not found" });
    }
    return res.json({
      message: `Two-factor authentication ${enabled ? "enabled" : "disabled"}`,
      user: { twoFactorEnabled: user.twoFactorEnabled }
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to update two-factor authentication");
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, profileImage } = req.body || {};
    if (name !== undefined && !isNonEmptyString(name)) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (
      profileImage !== undefined &&
      (typeof profileImage !== "string" || profileImage.length > 450 * 1024)
    ) {
      return res.status(400).json({ message: "Profile image is too large or invalid" });
    }
    if (name === undefined && profileImage === undefined) {
      return res.status(400).json({
        message: "At least one profile field is required to update"
      });
    }

    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (profileImage !== undefined) update.profileImage = profileImage;

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: update },
      { returnDocument: "after", runValidators: true }
    ).select("_id name email profileImage");

    if (!user) {
      return res.status(404).json({ message: "Member account not found" });
    }

    return res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to update profile");
  }
};

const updateOrganization = async (req, res) => {
  const organizationName = req.body?.organizationName;
  if (!isNonEmptyString(organizationName) || organizationName.trim().length > 120) {
    return res.status(400).json({ message: "Organization name is required and must be at most 120 characters" });
  }

  try {
    const organization = await Organization.findOneAndUpdate(
      { _id: req.user.organizationId },
      { $set: { name: organizationName.trim() } },
      { returnDocument: "after", runValidators: true }
    ).select("name");
    if (!organization) return res.status(404).json({ message: "Organization not found" });
    return res.json({
      message: "Organization name updated successfully",
      user: { organizationName: organization.name }
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "An organization with this name already exists" });
    return handleControllerError(res, error, "Organization update failed");
  }
};

const deleteOrganization = async (req, res) => {
  const { confirmationName, confirmationText } = req.body || {};
  if (!isNonEmptyString(confirmationName) || confirmationText !== "DELETE") {
    return res.status(400).json({ message: "Enter the organization name and DELETE to confirm" });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const organization = await Organization.findById(req.user.organizationId).session(session);
      if (!organization) throw Object.assign(new Error("Organization not found"), { status: 404 });
      if (confirmationName.trim() !== organization.name) {
        throw Object.assign(new Error("Organization name confirmation does not match"), { status: 400 });
      }

      const organizationFilter = { organizationId: organization._id };
      for (const model of [Payment, Udhaar, Sale, StockHistory, Notification, Product, Category, Customer, User]) {
        await model.deleteMany(organizationFilter, { session });
      }
      const deleted = await Organization.deleteOne({ _id: organization._id }, { session });
      if (!deleted.deletedCount) throw Object.assign(new Error("Organization could not be deleted"), { status: 409 });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    return res.json({ message: "Organization and its account data were deleted" });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return handleControllerError(res, error, "Organization deletion failed");
  } finally {
    await session.endSession();
  }
};

const updateOrganizationUser = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid member ID" });
    }
    if (String(req.params.id) === String(req.user.userId)) {
      return res.status(400).json({ message: "Administrators cannot manage their own account here" });
    }

    const { name, email, isActive, permissions } = req.body || {};
    const update = {};
    if (name !== undefined) {
      if (!isNonEmptyString(name)) {
        return res.status(400).json({ message: "Name is required" });
      }
      update.name = name.trim();
    }
    if (email !== undefined) {
      if (!isNonEmptyString(email) || !isValidEmail(email.trim())) {
        return res.status(400).json({ message: "Enter a valid email address" });
      }
      update.email = email.trim();
    }
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ message: "isActive must be a boolean" });
      }
      update.isActive = isActive;
    }
    if (permissions !== undefined) {
      if (!Array.isArray(permissions) || permissions.some((permission) => !PERMISSION_SET.has(permission))) {
        return res.status(400).json({ message: "permissions must contain only supported permission names" });
      }
      update.permissions = [...new Set(permissions)];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "At least one field is required to update" });
    }

    const user = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId: req.user.organizationId,
        role: "user"
      },
      {
        $set: update,
        ...(isActive !== undefined ? { $inc: { authVersion: 1 } } : {})
      },
      { returnDocument: "after", runValidators: true }
    ).select("_id name email role organizationId permissions mustChangePassword isActive");
    if (!user) {
      return res.status(404).json({ message: "Member not found in this organization" });
    }

    return res.json({
      message: "Organization member updated successfully",
      user: { ...user.toObject(), permissions: user.permissions || [] }
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to update organization member");
  }
};

const deleteOrganizationUser = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid member ID" });
    }
    if (String(req.params.id) === String(req.user.userId)) {
      return res.status(400).json({ message: "Administrators cannot delete their own account here" });
    }

    const user = await User.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.user.organizationId,
      role: "user"
    }).select("_id");
    if (!user) {
      return res.status(404).json({ message: "Member not found in this organization" });
    }

    return res.json({ message: "Organization member deleted successfully" });
  } catch (error) {
    return handleControllerError(res, error, "Failed to delete organization member");
  }
};

const resetOrganizationUserPassword = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid member ID" });
    }
    if (String(req.params.id) === String(req.user.userId)) {
      return res.status(400).json({ message: "Use Forgot Password to reset your own password" });
    }

    const { password } = req.body || {};
    if (!isValidPassword(password)) {
      return res.status(400).json({ message: "Enter a strong password (8-72 bytes)" });
    }

    const user = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId: req.user.organizationId,
        role: "user"
      },
      {
        $set: {
          password: await bcrypt.hash(password, 10),
          mustChangePassword: true
        },
        $unset: {
          passwordResetTokenHash: 1,
          passwordResetExpiresAt: 1,
          passwordResetOtpHash: 1,
          passwordResetOtpExpiresAt: 1,
          passwordResetOtpAttempts: 1,
          passwordResetOtpSentAt: 1
        },
        $inc: { authVersion: 1 }
      },
      { returnDocument: "after", runValidators: true }
    ).select("_id name email");
    if (!user) {
      return res.status(404).json({ message: "Member not found in this organization" });
    }

    return res.json({
      message: "Member password reset successfully. Share the new password securely.",
      user
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to reset organization member password");
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body || {};
  if (!isNonEmptyString(email) || !isValidEmail(email.trim())) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const otp = createOtp();
    const sentAt = new Date();
    const user = await User.findOneAndUpdate(
      {
        email: emailFilter(cleanEmail),
        isActive: { $ne: false },
        $or: [
          { passwordResetOtpSentAt: { $exists: false } },
          { passwordResetOtpSentAt: { $lte: new Date(sentAt.getTime() - OTP_RESEND_COOLDOWN_MS) } }
        ]
      },
      {
        $set: {
          passwordResetOtpHash: hashOtp(otp),
          passwordResetOtpExpiresAt: new Date(sentAt.getTime() + OTP_TTL_MS),
          passwordResetOtpAttempts: 0,
          passwordResetOtpSentAt: sentAt
        },
        $unset: {
          passwordResetTokenHash: 1,
          passwordResetExpiresAt: 1
        }
      },
      { returnDocument: "after" }
    ).select("_id email passwordResetOtpHash");

    if (user) {
      try {
        await sendOtpEmail(user.email, otp, "passwordReset");
      } catch (error) {
        console.error("Password reset email delivery failed");
        await clearOtp(
          user._id,
          "passwordResetOtpHash",
          "passwordResetOtpExpiresAt",
          "passwordResetOtpAttempts",
          "passwordResetOtpSentAt",
          user.passwordResetOtpHash
        );
      }
    }

    return res.json({ message: passwordResetMessage });
  } catch (error) {
    return handleControllerError(res, error, "Failed to request password reset");
  }
};

const verifyResetOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  if (!isValidOtpRequest(email, otp)) {
    return res.status(400).json({ message: "Enter a valid email address and 6-digit code" });
  }

  try {
    const resetToken = crypto.randomBytes(32).toString("hex");
    const user = await User.findOneAndUpdate(
      {
        email: emailFilter(email),
        isActive: { $ne: false },
        passwordResetOtpHash: hashOtp(otp),
        passwordResetOtpExpiresAt: { $gt: new Date() },
        passwordResetOtpAttempts: { $lt: OTP_MAX_ATTEMPTS }
      },
      {
        $set: {
          passwordResetTokenHash: hashResetToken(resetToken),
          passwordResetExpiresAt: new Date(Date.now() + OTP_TTL_MS)
        },
        $unset: {
          passwordResetOtpHash: 1,
          passwordResetOtpExpiresAt: 1,
          passwordResetOtpAttempts: 1,
          passwordResetOtpSentAt: 1
        }
      },
      { returnDocument: "after" }
    ).select("_id");

    if (!user) {
      const attempt = await incrementOtpAttempts(
        email.trim(),
        "passwordResetOtpAttempts",
        "passwordResetOtpHash",
        "passwordResetOtpExpiresAt"
      );
      return res.status(attempt?.passwordResetOtpAttempts >= OTP_MAX_ATTEMPTS ? 429 : 400)
        .json({ message: "Verification code is invalid or expired" });
    }

    return res.json({ resetToken });
  } catch (error) {
    return handleControllerError(res, error, "Password reset verification failed");
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (
      typeof token !== "string" ||
      !/^[a-f\d]{64}$/i.test(token) ||
      !isValidPassword(password)
    ) {
      return res.status(400).json({
        message: "Enter a valid reset token and a strong password"
      });
    }

    const user = await User.findOneAndUpdate(
      {
        passwordResetTokenHash: hashResetToken(token),
        passwordResetExpiresAt: { $gt: new Date() }
      },
      {
        $set: {
          password: await bcrypt.hash(password, 10),
          mustChangePassword: false
        },
        $unset: {
          passwordResetTokenHash: 1,
          passwordResetExpiresAt: 1,
          passwordResetOtpHash: 1,
          passwordResetOtpExpiresAt: 1,
          passwordResetOtpAttempts: 1,
          passwordResetOtpSentAt: 1
        },
        $inc: { authVersion: 1 }
      },
      { returnDocument: "after", runValidators: true }
    );
    if (!user) {
      return res.status(400).json({ message: "Reset token is invalid or expired" });
    }

    return res.json({ message: "Password reset successfully" });
  } catch (error) {
    return handleControllerError(res, error, "Failed to reset password");
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, password } = req.body || {};
    if (!isNonEmptyString(currentPassword) || !isValidPassword(password)) {
      return res.status(400).json({
        message: "Enter your current password and a strong new password"
      });
    }

    const user = await User.findById(req.user.userId).select("+password +authVersion");
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const currentAuthVersion = user.authVersion ?? 0;
    const nextAuthVersion = currentAuthVersion + 1;
    const result = await User.updateOne(
      {
        _id: user._id,
        $or: [
          { authVersion: currentAuthVersion },
          ...(currentAuthVersion === 0 ? [{ authVersion: { $exists: false } }] : [])
        ]
      },
      {
        $set: {
          password: await bcrypt.hash(password, 10),
          mustChangePassword: false
        },
        $unset: {
          passwordResetTokenHash: 1,
          passwordResetExpiresAt: 1,
          passwordResetOtpHash: 1,
          passwordResetOtpExpiresAt: 1,
          passwordResetOtpAttempts: 1,
          passwordResetOtpSentAt: 1
        },
        $inc: { authVersion: 1 }
      },
      { runValidators: true }
    );
    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Password changed in another session. Please sign in again." });
    }

    return res.json({
      message: "Password changed successfully",
      token: createAccessToken({ ...user.toObject(), authVersion: nextAuthVersion }),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        organizationId: user.organizationId,
        role: user.role,
        permissions: Array.isArray(user.permissions) ? user.permissions : DEFAULT_MEMBER_PERMISSIONS,
        profileImage: user.profileImage,
        mustChangePassword: false,
        hasPassword: true,
        twoFactorEnabled: isTwoFactorEnabled(user)
      }
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to change password");
  }
};

module.exports = {
  registerUser,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  loginUser,
  resendTwoFactor,
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
};
