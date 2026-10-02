const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");

let productUpdateOptions;
let historyCreateOptions;
let sessionEnded;
const session = {
  withTransaction: async (callback) => callback(),
  endSession: async () => { sessionEnded = true; }
};
const product = {
  _id: "507f1f77bcf86cd799439013",
  quantity: 7
};
const fakeProduct = {
  findOneAndUpdate: async (_filter, _update, options) => {
    productUpdateOptions = options;
    return product;
  },
  exists: async () => ({ session: () => null })
};
const fakeHistory = {
  create: async (_records, options) => {
    historyCreateOptions = options;
    return [{
      type: "out",
      quantity: 3
    }];
  }
};
const originalStartSession = mongoose.startSession;
mongoose.startSession = async () => session;

const originalLoad = Module._load;
Module._load = function loadWithStockStubs(request, parent, isMain) {
  if (parent?.filename.endsWith("/controllers/stockController.js")) {
    if (request === "../models/Product") return fakeProduct;
    if (request === "../models/StockHistory") return fakeHistory;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { stockOut } = require("../controllers/stockController");
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

test("stock quantity and history writes share a transaction session", async () => {
  productUpdateOptions = undefined;
  historyCreateOptions = undefined;
  sessionEnded = false;
  const response = responseRecorder();

  await stockOut({
    body: { productId: "507f1f77bcf86cd799439013", quantity: 3 },
    user: {
      userId: "507f1f77bcf86cd799439011",
      organizationId: "507f1f77bcf86cd799439012"
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.currentStock, 7);
  assert.equal(productUpdateOptions.session, session);
  assert.equal(historyCreateOptions.session, session);
  assert.equal(sessionEnded, true);
});

test("restore mongoose session provider after stock tests", () => {
  mongoose.startSession = originalStartSession;
});
