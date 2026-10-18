const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../app");

test("forgot-password requests are limited to five per IP in the configured window", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  const statuses = [];
  for (let request = 0; request < 6; request += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/users/ForgotPassword`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid" })
    });
    statuses.push(response.status);
  }

  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
});

test("password-reset OTP verification is limited to five requests per IP", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  const statuses = [];
  for (let request = 0; request < 6; request += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/users/VerifyResetOtp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid", otp: "000000" })
    });
    statuses.push(response.status);
  }

  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
});
