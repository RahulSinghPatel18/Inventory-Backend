const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "";
process.env.JWT_SECRET = "test-only-jwt-secret-that-is-long-enough";
const app = require("../app");

test("HTTP layer applies security headers, CORS policy, auth, and clean errors", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.equal(root.headers.get("x-powered-by"), null);
    assert.equal(root.headers.get("x-content-type-options"), "nosniff");
    assert.equal(root.headers.get("x-frame-options"), "DENY");

    const allowed = await fetch(`${base}/products/GetAll`, {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(allowed.status, 401);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "http://localhost:5173"
    );

    const deployedPreflight = await fetch(`${base}/users/Login`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://inventorystack.netlify.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    assert.equal(deployedPreflight.status, 204);
    assert.equal(
      deployedPreflight.headers.get("access-control-allow-origin"),
      "https://inventorystack.netlify.app"
    );
    assert.match(
      deployedPreflight.headers.get("access-control-allow-methods"),
      /POST/
    );

    const deployedLogin = await fetch(`${base}/users/Login`, {
      method: "POST",
      headers: {
        Origin: "https://inventorystack.netlify.app",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    assert.equal(deployedLogin.status, 400);
    assert.equal(
      deployedLogin.headers.get("access-control-allow-origin"),
      "https://inventorystack.netlify.app"
    );

    const unauthorized = await allowed.json();
    assert.equal(unauthorized.error, undefined);
    assert.equal(unauthorized.stack, undefined);

    const blocked = await fetch(`${base}/`, {
      headers: { Origin: "https://untrusted.example" }
    });
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { message: "Origin is not allowed" });

    const unknown = await fetch(`${base}/unknown`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { message: "Endpoint not found" });

    const legacyAdminToken = jwt.sign({
      userId: "507f1f77bcf86cd799439011",
      organizationId: "507f1f77bcf86cd799439012",
      role: "Admin"
    }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "1m" });
    const legacyRole = await fetch(`${base}/products/UnknownRoute`, {
      headers: { Authorization: `Bearer ${legacyAdminToken}` }
    });
    assert.equal(legacyRole.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
