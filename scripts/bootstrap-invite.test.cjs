const { test } = require("node:test");
const assert = require("node:assert/strict");
const { options } = require("./bootstrap-invite.cjs");
const env = { DATABASE_URL: "postgresql://localhost@helium/heliumdb" };
test("defaults to non-mutating development rehearsal", () => {
  assert.deepEqual(options([], env), { apply: false });
});
test("apply requires explicit development environment", () => {
  assert.throws(() => options(["--apply-development"], env));
  assert.deepEqual(options(["--apply-development"], { ...env, NODE_ENV: "development" }), { apply: true });
});
test("production, deployment, external databases and unknown flags fail closed", () => {
  for (const change of [
    { NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" },
    { DATABASE_URL: "postgresql://user@production/db" }, { DATABASE_URL: "" },
  ]) assert.throws(() => options([], { ...env, ...change }));
  assert.throws(() => options(["--apply-production"], env));
});