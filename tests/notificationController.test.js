const test = require("node:test");
const assert = require("node:assert/strict");
const Notification = require("../models/Notification");
const {
  dismissNotification,
  dismissAllNotifications
} = require("../controllers/notificationController");

const createResponse = () => ({
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

test("dismisses one notification only for the requesting member", async (t) => {
  let query;
  let update;
  t.mock.method(Notification, "updateOne", async (filter, operation) => {
    query = filter;
    update = operation;
    return { matchedCount: 1 };
  });

  const req = {
    params: { id: "507f1f77bcf86cd799439011" },
    user: { organizationId: "organization-1", userId: "member-1" }
  };
  const res = createResponse();
  await dismissNotification(req, res, assert.fail);

  assert.deepEqual(query, {
    _id: req.params.id,
    organizationId: req.user.organizationId,
    dismissedBy: { $ne: req.user.userId }
  });
  assert.deepEqual(update, { $addToSet: { dismissedBy: req.user.userId } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: "Notification dismissed" });
});

test("clear all dismisses notifications for only the requesting member's organization scope", async (t) => {
  let query;
  let update;
  t.mock.method(Notification, "updateMany", async (filter, operation) => {
    query = filter;
    update = operation;
    return { modifiedCount: 2 };
  });

  const req = { user: { organizationId: "organization-1", userId: "member-1" } };
  const res = createResponse();
  await dismissAllNotifications(req, res, assert.fail);

  assert.deepEqual(query, {
    organizationId: req.user.organizationId,
    dismissedBy: { $ne: req.user.userId }
  });
  assert.deepEqual(update, { $addToSet: { dismissedBy: req.user.userId } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: "Notifications cleared" });
});

test("rejects invalid notification IDs before accessing the database", async (t) => {
  t.mock.method(Notification, "updateOne", assert.fail);
  const req = {
    params: { id: "not-an-id" },
    user: { organizationId: "organization-1", userId: "member-1" }
  };
  const res = createResponse();
  await dismissNotification(req, res, assert.fail);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "Invalid notification ID" });
});
