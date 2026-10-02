const { test } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../app");

test("login limiter returns a clear 429 after the configured threshold", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const url = `http://127.0.0.1:${server.address().port}/users/Login`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      assert.equal(response.status, 400);
    }

    const limited = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), {
      message: "Too many login attempts. Please try again in 15 minutes."
    });
    assert.ok(limited.headers.get("ratelimit"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
