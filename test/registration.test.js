const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");
const originalStartSession = mongoose.startSession;

mongoose.startSession = async () => ({
  withTransaction: async (callback) => {
    const originalOrganizationCount = organizationCreateCount;
    const originalUserPayload = userCreatePayload;
    try {
      return await callback();
    } catch (error) {
      organizationCreateCount = originalOrganizationCount;
      userCreatePayload = originalUserPayload;
      throw error;
    }
  },
  endSession: async () => {}
});

let matchingOrganization = false;
let organizationCreateCount = 0;
let rejectUserCreation = false;
let userCreatePayload;

const fakeUser = {
  exists: async () => false,
  create: async (payload) => {
    if (rejectUserCreation) throw new Error("Simulated user creation failure");
    userCreatePayload = payload[0];
    return [{
      _id: "507f1f77bcf86cd799439012",
      name: payload[0].name,
      email: payload[0].email,
      organizationId: payload[0].organizationId
    }];
  }
};

const fakeOrganization = {
  exists: async () => matchingOrganization,
  create: async (payload) => {
    organizationCreateCount += 1;
    return [{ _id: "507f1f77bcf86cd799439013", name: payload[0].name }];
  }
};

const originalLoad = Module._load;
Module._load = function loadWithModelStubs(request, parent, isMain) {
  if (parent?.filename.endsWith("/controllers/userController.js")) {
    if (request === "../models/User") return fakeUser;
    if (request === "../models/Organization") return fakeOrganization;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { registerUser } = require("../controllers/userController");
Module._load = originalLoad;

const request = {
  body: {
    name: "Owner",
    email: "owner@example.com",
    password: "a valid password",
    organizationName: "Existing workspace"
  }
};

const responseRecorder = () => ({
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

test("public registration cannot join an existing organization as admin", async () => {
  matchingOrganization = true;
  organizationCreateCount = 0;
  const response = responseRecorder();

  await registerUser(request, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /administrator/i);
  assert.equal(organizationCreateCount, 0);
  assert.equal(userCreatePayload, undefined);
});

test("registration rejects malformed email values before database access", async () => {
  const response = responseRecorder();
  await registerUser({ body: { ...request.body, email: ["owner@example.com"] } }, response);
  assert.equal(response.statusCode, 400);
});

test("registration rejects passwords shorter than eight characters", async () => {
  const response = responseRecorder();
  await registerUser({
    body: { ...request.body, password: "short" }
  }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /8-72 bytes/);
});

test("failed owner creation rolls back its organization transaction", async () => {
  matchingOrganization = false;
  organizationCreateCount = 0;
  userCreatePayload = undefined;
  rejectUserCreation = true;
  const response = responseRecorder();

  await registerUser(request, response);

  rejectUserCreation = false;
  assert.equal(response.statusCode, 500);
  assert.equal(organizationCreateCount, 0);
  assert.equal(userCreatePayload, undefined);
  assert.equal(response.body.error, undefined);
});

test("first registration retains organization-owner admin setup", async () => {
  matchingOrganization = false;
  organizationCreateCount = 0;
  rejectUserCreation = false;
  userCreatePayload = undefined;
  const response = responseRecorder();

  await registerUser(request, response);

  assert.equal(response.statusCode, 201);
  assert.equal(organizationCreateCount, 1);
  assert.equal(userCreatePayload.role, "admin");
  assert.notEqual(userCreatePayload.password, request.body.password);
  assert.deepEqual(Object.keys(response.body.user).sort(), [
    "email",
    "id",
    "name",
    "organizationId"
  ]);
});

test("restore mongoose session provider after registration tests", () => {
  mongoose.startSession = originalStartSession;
});
