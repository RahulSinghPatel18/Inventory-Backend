const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../app");

test("organization APIs reject requests without a bearer token", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const paths = [
    "/users/Profile",
    "/products/GetAll",
    "/categories/GetAll",
    "/stock/Summary",
    "/sales/",
    "/customers/",
    "/udhaar/",
    "/notifications/",
    "/api/v1/export/full-backup",
    "/api/v1/export/reports",
    "/api/v1/export/products",
    "/api/v1/export/sales",
    "/api/v1/export/stock-history",
    "/api/v1/export/customers",
    "/api/v1/export/udhaar",
    "/feedback"
  ];

  const responses = await Promise.all(paths.map((path) => (
    fetch(`http://127.0.0.1:${port}${path}`)
  )));
  assert.deepEqual(responses.map((response) => response.status), paths.map(() => 401));
});
