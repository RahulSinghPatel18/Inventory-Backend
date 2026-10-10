const test = require("node:test");
const assert = require("node:assert/strict");
const permission = require("../middleware/permissionMiddleware");

const invoke = (role, permissions, required) => {
  const req = { user: role ? { role, permissions } : null };
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
  permission(required)(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

test("allows administrators and any explicitly assigned matching permission", () => {
  assert.equal(invoke("admin", [], "users.delete").nextCalled, true);
  assert.equal(invoke("Admin", [], "users.delete").nextCalled, true);
  assert.equal(invoke("user", ["products.view"], ["products.view", "products.create"]).nextCalled, true);
});

test("denies missing permissions and recognizes supported legacy aliases", () => {
  const denied = invoke("user", ["products.view"], "products.delete");
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);

  assert.equal(invoke("user", ["customers.edit"], "customers.update").nextCalled, true);
});

test("requires authenticated identity before evaluating permissions", () => {
  const { res, nextCalled } = invoke(undefined, [], "products.view");
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
