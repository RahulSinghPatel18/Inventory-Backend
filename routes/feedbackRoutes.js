const express = require("express");
const { submitFeedback } = require("../controllers/feedbackController");
const { feedbackRateLimit } = require("../middleware/authRateLimit");

const router = express.Router();

router.post("/", feedbackRateLimit, submitFeedback);

module.exports = router;
