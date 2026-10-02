const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  escapeRegex,
  isNonEmptyString,
  isValidObjectId,
  parsePagination
} = require("../utils/requestValidation");

test("pagination uses API defaults and rejects invalid or unsafe values", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 10, skip: 0 });
  assert.deepEqual(parsePagination({ page: "3", limit: "25" }), {
    page: 3,
    limit: 25,
    skip: 50
  });
  assert.equal(parsePagination({ limit: "101" }), null);
  assert.equal(parsePagination({ page: ["1"] }), null);
  assert.equal(parsePagination({ page: "9007199254740991" }), null);
});

test("request string and object ID validators reject invalid input", () => {
  assert.equal(isNonEmptyString("  item  "), true);
  assert.equal(isNonEmptyString("  "), false);
  assert.equal(isValidObjectId("507f1f77bcf86cd799439011"), true);
  assert.equal(isValidObjectId("not-an-id"), false);
  assert.equal(isValidObjectId("abcdefghijkl"), false);
});

test("search text is treated as literal regex content", () => {
  assert.equal(escapeRegex("item.*(1)"), "item\\.\\*\\(1\\)");
});
