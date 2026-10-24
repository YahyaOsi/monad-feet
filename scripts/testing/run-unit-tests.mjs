import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));

// Deliberate allowlist: new database-backed tests must never enter CI implicitly.
// These tests use local fixtures, in-memory adapters, or mocked RPC responses.
const files = [
  "artifacts/monad-feet/src/content/publicContent.test.ts",
  "artifacts/monad-feet/src/lib/analyticsCore.test.ts",
  "artifacts/monad-feet/src/lib/communityViews.test.ts",
  "artifacts/monad-feet/src/lib/dmState.test.ts",
  "artifacts/monad-feet/src/lib/notifications.test.ts",
  "artifacts/monad-feet/src/lib/publicSite.test.ts",
  "artifacts/monad-feet/src/lib/queryKeys.test.ts",
  "artifacts/monad-feet/src/lib/registrationRecovery.test.ts",
  "artifacts/monad-feet/src/lib/shareNavigation.test.ts",
  "artifacts/monad-feet/src/lib/subscriptionRecovery.test.ts",
  "artifacts/api-server/src/reward-rules.test.mjs",
  "artifacts/api-server/src/lib/appUpdates.test.mjs",
  "artifacts/api-server/src/lib/bootstrapInvite.test.ts",
  "artifacts/api-server/src/lib/gameChain.test.mjs",
  "artifacts/api-server/src/lib/notificationQueries.test.ts",
  "artifacts/api-server/src/lib/postPublication.client.test.mjs",
  "artifacts/api-server/src/lib/postRecovery.test.ts",
  "artifacts/api-server/src/lib/privacyRequirements.test.ts",
  "artifacts/api-server/src/lib/registrationChain.test.mjs",
  "artifacts/api-server/src/lib/registrationRoutes.test.mjs",
  "artifacts/api-server/src/lib/requestCapacity.test.ts",
  "artifacts/api-server/src/lib/socialChain.test.ts",
  "artifacts/api-server/src/lib/spaPointRules.test.mjs",
  "artifacts/api-server/src/lib/walletAuthRules.test.mjs",
  "lib/api-client-react/src/custom-fetch.test.ts",
  "scripts/bootstrap-invite.test.cjs",
  "scripts/reconcile-registrations.test.cjs",
];

for (const file of files) {
  if (!existsSync(new URL(`../../${file}`, import.meta.url))) {
    throw new Error(`Missing required unit test: ${file}`);
  }
}

const env = { ...process.env, NODE_ENV: "test", RUN_DATABASE_TESTS: "0" };
// Some helpers construct a lazy pool on import. Never inherit a real database:
// an unexpected query must fail against this unused localhost port, not user data.
env.DATABASE_URL = "postgresql://127.0.0.1:1/monad_feet_fixture";
delete env.SESSION_SECRET;

const result = spawnSync(
  process.execPath,
  [require.resolve("tsx/cli"), "--test", "--test-reporter=spec", ...files],
  { cwd: root, env, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
