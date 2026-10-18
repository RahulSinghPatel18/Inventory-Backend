const test = require("node:test");
const assert = require("node:assert/strict");
const { hasUnsafeKeys, requestSecurity } = require("../middleware/requestSecurity");

test("rejects Mongo operators and dotted/prototype keys recursively", () => {
  assert.equal(hasUnsafeKeys({ name: "Valid" }), false);
  assert.equal(hasUnsafeKeys({ filter: { $ne: null } }), true);
  assert.equal(hasUnsafeKeys({ items: [{ "price.cost": 10 }] }), true);
  assert.equal(hasUnsafeKeys(JSON.parse('{"__proto__":{"polluted":true}}')), true);
});

test("request middleware rejects unsafe body and query keys", () => {
  for (const req of [
    { body: { name: { $gt: "" } }, query: {} },
    { body: {}, query: { $where: "true" } }
  ]) {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    let nextCalled = false;
    requestSecurity(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
  }
});
