const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProduct,
  getProducts,
  updateProduct
} = require("../controllers/productController");
const Category = require("../models/Category");
const Product = require("../models/Product");

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

test("creates products with an optional validated unit cost", async () => {
  const originalCategoryExists = Category.exists;
  const originalProductCreate = Product.create;
  const organizationId = "507f1f77bcf86cd799439012";
  const categoryId = "507f1f77bcf86cd799439013";
  let savedProduct;
  Category.exists = async (filter) => (
    filter._id === categoryId && filter.organizationId === organizationId
  );
  Product.create = async (product) => {
    savedProduct = product;
    return product;
  };

  try {
    const res = createResponse();
    await createProduct({
      body: {
        name: "Product",
        price: "12.50",
        cost: "8.25",
        quantity: "4",
        category: categoryId
      },
      user: { organizationId, userId: "507f1f77bcf86cd799439014" }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(savedProduct.cost, 8.25);
  } finally {
    Category.exists = originalCategoryExists;
    Product.create = originalProductCreate;
  }
});

test("hides product unit costs from read-only members", async () => {
  const originalAggregate = Product.aggregate;
  const originalCountDocuments = Product.countDocuments;
  const pipelines = [];
  Product.aggregate = async (pipeline) => {
    pipelines.push(pipeline);
    return [];
  };
  Product.countDocuments = async () => 0;

  try {
    const query = { page: "1", limit: "10", sortBy: "totalValue", sortOrder: "desc" };
    const memberResponse = createResponse();
    await getProducts({
      query,
      user: {
        organizationId: "507f1f77bcf86cd799439012",
        role: "user",
        permissions: ["products.view"]
      }
    }, memberResponse);
    const memberProjection = pipelines[0].at(-1).$project;
    assert.equal(memberProjection.cost, 0);

    const adminResponse = createResponse();
    await getProducts({
      query,
      user: {
        organizationId: "507f1f77bcf86cd799439012",
        role: "admin",
        permissions: []
      }
    }, adminResponse);
    assert.equal(Object.hasOwn(pipelines[1].at(-1).$project, "cost"), false);
  } finally {
    Product.aggregate = originalAggregate;
    Product.countDocuments = originalCountDocuments;
  }
});
