#!/usr/bin/env node
// Development rehearsal only. Production provisioning is an owner operation.
const { randomBytes } = require("node:crypto");
const { createRequire } = require("node:module");
const path = require("node:path");

function options(args, env) {
  if (args.some(a => a !== "--apply-development") || args.length > 1) throw new Error("Use no arguments (dry-run) or --apply-development");
  const url = new URL(env.DATABASE_URL || "invalid:");
  if (env.REPLIT_DEPLOYMENT || env.NODE_ENV === "production" ||
      url.hostname !== "helium" || url.pathname !== "/heliumdb") throw new Error("Development helium database required; production is never supported");
  const apply = args.includes("--apply-development");
  if (apply && env.NODE_ENV !== "development") throw new Error("Explicit NODE_ENV=development required");
  return { apply };
}

async function main() {
  const { apply } = options(process.argv.slice(2), process.env);
  const { Client } = createRequire(path.resolve(__dirname, "../lib/db/package.json"))("pg");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    // Lock only on explicit apply; never overwrite or delete existing data.
    if (apply) await db.query("LOCK TABLE invite_codes IN SHARE ROW EXCLUSIVE MODE");
    const { rows } = await db.query("SELECT count(*)::int AS count FROM invite_codes WHERE owner_id IS NULL AND used_by_id IS NULL");
    if (rows[0].count > 0) {
      console.log("An unused team invitation already exists; no changes. Retrieve it privately as database owner.");
    } else if (!apply) {
      console.log("Dry-run: would create one cryptographically random, unused team invitation. No code generated or data changed.");
    } else {
      const code = randomBytes(20).toString("hex").toUpperCase();
      await db.query("INSERT INTO invite_codes (code) VALUES ($1)", [code]);
      // Deliberately do not expose the bearer invitation in terminal logs.
      console.log("Created one team invitation. Retrieve it privately as database owner; do not commit or publish it.");
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}
module.exports = { options };
if (require.main === module) main().catch(error => {
  console.error(error instanceof Error ? error.message : "Invitation bootstrap failed");
  process.exitCode = 1;
});