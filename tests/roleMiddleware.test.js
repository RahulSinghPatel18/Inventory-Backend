const test = require("node:test");
const assert = require("node:assert/strict");
const adminMiddleware = require("../middleware/roleMiddleware");

const invoke = (user) => {
  const req = { user };
  const res = {
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
  };
  let nextCalled = false;
  adminMiddleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

test("allows canonical and legacy administrator role casing", () => {
  assert.equal(invoke({ role: "admin" }).nextCalled, true);
  assert.equal(invoke({ role: "Admin" }).nextCalled, true);
});

test("denies regular members and unauthenticated requests", () => {
  const member = invoke({ role: "user" });
  assert.equal(member.nextCalled, false);
  assert.equal(member.res.statusCode, 403);

  const anonymous = invoke(null);
  assert.equal(anonymous.nextCalled, false);
  assert.equal(anonymous.res.statusCode, 401);
});
