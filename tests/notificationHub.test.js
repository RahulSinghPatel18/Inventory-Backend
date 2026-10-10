const test = require("node:test");
const assert = require("node:assert/strict");
const notificationHub = require("../utils/notificationHub");

const createResponse = () => ({
  writableEnded: false,
  destroyed: false,
  events: [],
  write(event) {
    this.events.push(event);
  }
});

test("publishes notifications only to subscribers in the matching organization", () => {
  const firstOrganization = createResponse();
  const otherOrganization = createResponse();
  const stop = notificationHub.subscribe("organization-a", firstOrganization);
  notificationHub.subscribe("organization-b", otherOrganization);

  notificationHub.publish({
    _id: "notification-1",
    organizationId: "organization-a",
    createdBy: "user-1",
    readBy: ["user-2"],
    type: "stock-low",
    title: "Low stock",
    message: "Only two left",
    entityType: "product",
    entityId: "product-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(firstOrganization.events.length, 1);
  assert.equal(otherOrganization.events.length, 0);
  assert.match(firstOrganization.events[0], /^event: notification\n/);
  assert.doesNotMatch(firstOrganization.events[0], /createdBy|readBy|organizationId/);

  stop();
});

test("removes closed subscribers and supports independent subscription cleanup", () => {
  const closedResponse = createResponse();
  const liveResponse = createResponse();
  closedResponse.destroyed = true;
  const stopClosed = notificationHub.subscribe("organization-cleanup", closedResponse);
  const stopLive = notificationHub.subscribe("organization-cleanup", liveResponse);

  notificationHub.publish({
    organizationId: "organization-cleanup",
    _id: "notification-2",
    type: "stock-out",
    title: "Out of stock",
    message: "No units left",
    entityType: "product",
    entityId: "product-2",
    createdAt: new Date()
  });
  assert.equal(closedResponse.events.length, 0);
  assert.equal(liveResponse.events.length, 1);

  stopClosed();
  stopLive();
  notificationHub.publish({ organizationId: "organization-cleanup" });
  assert.equal(liveResponse.events.length, 1);
});
