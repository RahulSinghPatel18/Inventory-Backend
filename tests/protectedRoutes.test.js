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
    "/notifications/"
  ];

  const responses = await Promise.all(paths.map((path) => (
    fetch(`http://127.0.0.1:${port}${path}`)
  )));
  assert.deepEqual(responses.map((response) => response.status), paths.map(() => 401));
});
