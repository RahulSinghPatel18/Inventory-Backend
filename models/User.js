const mongoose = require('mongoose');
const { PERMISSIONS, DEFAULT_MEMBER_PERMISSIONS } = require("../utils/permissions");

const userSchema = new mongoose.Schema({
    name :{
        type: String,
        required: [true, "Name is required"],
        trim: true
    },

    email:{
        type: String,
        required: [true, "Email is required"],
        unique: true,
        trim: true
    },

    password:{
        type: String,
        required: function passwordRequired() {
            return !this.googleId;
        },
        trim: true,
        select: false
    },

    role:{
        type: String,
        enum: ["user", "admin"],
        default: "user"
    },
    permissions: {
        type: [String],
        enum: PERMISSIONS,
        default: function defaultPermissions() {
            return this.role === "user" ? DEFAULT_MEMBER_PERMISSIONS : [];
        }
    },

     organizationId: {
         type: mongoose.Schema.Types.ObjectId,
         ref: "Organization",
         required: true
         },
    profileImage: {
        type: String,
        default: ""
    },
    mustChangePassword: {
        type: Boolean,
        default: false
    },
    emailVerified: {
        type: Boolean,
        default: true
    },
    googleId: {
        type: String,
        select: false,
        unique: true,
        sparse: true
    },
    twoFactorEnabled: {
        type: Boolean,
        default: function defaultTwoFactorEnabled() {
            return this.role === "admin";
        }
    },
    twoFactorOtpHash: {
        type: String,
        select: false
    },
    twoFactorOtpExpiresAt: {
        type: Date,
        select: false
    },
    twoFactorOtpAttempts: {
        type: Number,
        select: false
    },
    twoFactorOtpSentAt: {
        type: Date,
        select: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    passwordResetTokenHash: {
        type: String,
        select: false
    },
    passwordResetExpiresAt: {
        type: Date,
        select: false
    },
    passwordResetOtpHash: {
        type: String,
        select: false
    },
    passwordResetOtpExpiresAt: {
        type: Date,
        select: false
    },
    passwordResetOtpAttempts: {
        type: Number,
        default: 0,
        select: false
    },
    passwordResetOtpSentAt: {
        type: Date,
        select: false
    },
    authVersion: {
        type: Number,
        default: 0,
        select: false
    }

});
userSchema.index({ passwordResetTokenHash: 1 }, { sparse: true });

const User = mongoose.model("User", userSchema);

module.exports = User;