const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

let capturedFilter;
const query = {
  sort() { return this; },
  skip() { return this; },
  limit() { return this; },
  populate() { return this; },
  then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); }
};
const fakeProduct = {
  countDocuments: async (filter) => {
    capturedFilter = filter;
    return 0;
  },
  find: (filter) => {
    capturedFilter = filter;
    return query;
  }
};

const originalLoad = Module._load;
Module._load = function loadWithProductStubs(request, parent, isMain) {
  if (parent?.filename.endsWith("/controllers/productController.js")) {
    if (request === "../models/Product") return fakeProduct;
    if (request === "../models/Category") return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { getProducts } = require("../controllers/productController");
Module._load = originalLoad;

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

test("product listing accepts empty optional filters sent by the frontend", async () => {
  const response = responseRecorder();
  await getProducts({
    query: { name: "", category: "", sort: "", page: "1" },
    user: {
      userId: "507f1f77bcf86cd799439011",
      organizationId: "507f1f77bcf86cd799439012",
      role: "admin"
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.products, []);
  assert.deepEqual(capturedFilter, {
    organizationId: "507f1f77bcf86cd799439012"
  });
});

test("product listing rejects malformed non-empty category filters", async () => {
  const response = responseRecorder();
  await getProducts({
    query: { category: "not-an-id" },
    user: { organizationId: "507f1f77bcf86cd799439012" }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Invalid category ID");
});
