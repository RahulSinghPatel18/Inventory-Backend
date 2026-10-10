const test = require("node:test");
const assert = require("node:assert/strict");
const { updateProduct } = require("../controllers/productController");

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

test("rejects product quantity changes outside stock movement APIs", async () => {
  const res = createResponse();
  await updateProduct({
    params: { id: "507f1f77bcf86cd799439011" },
    body: { quantity: 50 },
    user: { organizationId: "507f1f77bcf86cd799439012" }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /authorized stock in\/out/i);
});
