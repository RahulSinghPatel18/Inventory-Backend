const mongoose = require("mongoose");

const feedbackReportSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  type: {
    type: String,
    enum: ["bug", "suggestion", "other"],
    required: true
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    trim: true,
    minlength: 15,
    maxlength: 2000
  },
  pagePath: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ""
  },
  status: {
    type: String,
    enum: ["new", "reviewing", "resolved"],
    default: "new"
  }
}, { timestamps: true });

feedbackReportSchema.index({ organizationId: 1, createdAt: -1 });
feedbackReportSchema.index({ submittedBy: 1, createdAt: -1 });

module.exports = mongoose.model("FeedbackReport", feedbackReportSchema);
