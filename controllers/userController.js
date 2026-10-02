const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const Organization = require("../models/Organization");
const handleControllerError = require("../utils/controllerError");
const { isNonEmptyString } = require("../utils/requestValidation");

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const registerUser = async (req, res) => {
  try {
    const { name, email, password, organizationName } = req.body || {};
    if (
      !isNonEmptyString(name) ||
      !isNonEmptyString(email) ||
      !isValidEmail(email.trim()) ||
      typeof password !== "string" ||
      password.length < 8 ||
      !isNonEmptyString(organizationName) ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        message: "Enter a name, valid email, password (8-72 bytes) and organization name"
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanOrganizationName = organizationName.trim();
    if (await User.exists({ email: cleanEmail })) {
      return res.status(400).json({ message: "User already exists" });
    }

    if (await Organization.exists({ name: cleanOrganizationName })) {
      return res.status(409).json({
        message: "Organization already exists. Ask its administrator to invite you."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const session = await mongoose.startSession();
    let organization;
    let user;
    try {
      await session.withTransaction(async () => {
        [organization] = await Organization.create([{
          name: cleanOrganizationName
        }], { session });
        [user] = await User.create([{
          name: cleanName,
          email: cleanEmail,
          password: hashedPassword,
          organizationId: organization._id,
          role: "admin"
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    return res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        organizationId: user.organizationId
      }
    });
  } catch (error) {
    return handleControllerError(res, error, "Registration failed");
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

    const user = await User.findOne({ email: email.trim() }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign({
      userId: user._id,
      role: user.role,
      organizationId: user.organizationId
    }, process.env.JWT_SECRET, {
      expiresIn: "1d",
      algorithm: "HS256"
    });

    return res.json({
      message: "Login successful",
      token
    });
  } catch (error) {
    return handleControllerError(res, error, "Login failed");
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select("-password")
      .populate("organizationId", "name");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const profile = user.toObject();
    const organization = profile.organizationId;
    return res.json({
      message: "Profile fetched successfully",
      user: {
        ...profile,
        organizationId: organization?._id || "",
        organizationName: organization?.name || ""
      }
    });
  } catch (error) {
    return handleControllerError(res, error, "Failed to fetch profile");
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
      return res.status(404).json({ message: "User not found" });
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

module.exports = { registerUser, loginUser, getProfile, updateProfile };
