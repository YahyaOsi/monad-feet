import { randomBytes } from "node:crypto";
import type { pool as dbPool } from "@workspace/db";

/** Fresh database only. Never resets admission or logs the bearer invitation. */
export async function bootstrapInvite(pool: Pick<typeof dbPool, "connect">): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(143, 20260930)");
    const { rows } = await client.query(
      "SELECT EXISTS (SELECT 1 FROM users) AS has_users, EXISTS (SELECT 1 FROM invite_codes) AS has_invites",
    );
    if (rows[0].has_users || rows[0].has_invites) {
      await client.query("COMMIT");
      return false;
    }
    await client.query("INSERT INTO invite_codes (code) VALUES ($1)", [
      randomBytes(20).toString("hex").toUpperCase(),
    ]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}