const test = require("node:test");
const assert = require("node:assert/strict");
const FeedbackReport = require("../models/FeedbackReport");
const { submitFeedback } = require("../controllers/feedbackController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

test("feedback submission stores the authenticated organization and user", async () => {
  const originalCreate = FeedbackReport.create;
  let savedReport;
  FeedbackReport.create = async (report) => {
    savedReport = report;
    return { _id: "report-id" };
  };
  const res = response();

  try {
    await submitFeedback({
      user: { organizationId: "organization-id", userId: "user-id" },
      body: {
        type: "bug",
        subject: "  Stock total is wrong  ",
        description: "  The stock total does not match the product list.  ",
        pagePath: "/stock"
      }
    }, res, (error) => { throw error; });
  } finally {
    FeedbackReport.create = originalCreate;
  }

  assert.equal(res.statusCode, 201);
  assert.equal(savedReport.organizationId, "organization-id");
  assert.equal(savedReport.submittedBy, "user-id");
  assert.equal(savedReport.subject, "Stock total is wrong");
  assert.equal(savedReport.description, "The stock total does not match the product list.");
  assert.equal(savedReport.pagePath, "/stock");
});

test("feedback submission rejects invalid categories, short details, and external page paths", async () => {
  const originalCreate = FeedbackReport.create;
  FeedbackReport.create = async () => {
    throw new Error("Invalid reports must not be saved");
  };

  try {
    for (const body of [
      { type: "unknown", subject: "Valid title", description: "A sufficiently long description." },
      { type: "bug", subject: "Valid title", description: "Too short" },
      { type: "bug", subject: "Valid title", description: "A sufficiently long description.", pagePath: "https://example.com" }
    ]) {
      const res = response();
      await submitFeedback({ body }, res, (error) => { throw error; });
      assert.equal(res.statusCode, 400);
    }
  } finally {
    FeedbackReport.create = originalCreate;
  }
});
