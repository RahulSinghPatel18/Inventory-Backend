const FeedbackReport = require("../models/FeedbackReport");

const submitFeedback = async (req, res, next) => {
  const { type, subject, description, pagePath = "" } = req.body || {};
  const supportedTypes = ["bug", "suggestion", "other"];

  if (typeof type !== "string" || !supportedTypes.includes(type)) {
    return res.status(400).json({ message: "Choose a valid feedback type" });
  }
  if (typeof subject !== "string" || subject.trim().length < 3 || subject.trim().length > 100) {
    return res.status(400).json({ message: "Subject must be between 3 and 100 characters" });
  }
  if (
    typeof description !== "string" ||
    description.trim().length < 15 ||
    description.trim().length > 2000
  ) {
    return res.status(400).json({ message: "Details must be between 15 and 2000 characters" });
  }
  if (
    typeof pagePath !== "string" ||
    pagePath.length > 200 ||
    (pagePath && !pagePath.startsWith("/"))
  ) {
    return res.status(400).json({ message: "Page path is invalid" });
  }

  try {
    const report = await FeedbackReport.create({
      organizationId: req.user.organizationId,
      submittedBy: req.user.userId,
      type,
      subject: subject.trim(),
      description: description.trim(),
      pagePath
    });
    return res.status(201).json({
      message: "Thanks for your feedback. Your report has been submitted.",
      reportId: report._id
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { submitFeedback };
