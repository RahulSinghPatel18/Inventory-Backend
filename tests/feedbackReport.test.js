const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const FeedbackReport = require("../models/FeedbackReport");

test("feedback reports require organization, user, type, subject, and useful details", async () => {
  const report = new FeedbackReport({
    organizationId: new mongoose.Types.ObjectId(),
    submittedBy: new mongoose.Types.ObjectId(),
    type: "bug",
    subject: "Stock total is wrong",
    description: "The stock summary is different from the product list."
  });

  await report.validate();
  assert.equal(report.status, "new");
});

test("feedback report model rejects unsupported report types and short descriptions", async () => {
  const report = new FeedbackReport({
    organizationId: new mongoose.Types.ObjectId(),
    submittedBy: new mongoose.Types.ObjectId(),
    type: "spam",
    subject: "Bug",
    description: "Too short"
  });

  await assert.rejects(report.validate(), (error) => {
    assert.ok(error.errors.type);
    assert.ok(error.errors.description);
    return true;
  });
});
