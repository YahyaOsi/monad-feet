import { sql } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";

export function digestWeekStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

/** Existing DIGEST bodies count regardless of title or read status. */
export async function deliverWeeklyDigest(
  userId: number, title: string, body: string, now = new Date(), database = db,
): Promise<boolean> {
  if (!body.startsWith("DIGEST:")) throw new Error("Invalid weekly digest body");
  const weekStart = digestWeekStart(now);
  return database.transaction(async tx => {
    // Transaction-scoped, cross-process lock. Read after acquiring the lock so
    // a competing committed insert is visible under READ COMMITTED.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1464092487, ${userId})`);
    const result = await tx.execute(sql`
      SELECT id FROM notifications
      WHERE user_id = ${userId} AND type = 'system'
        AND body LIKE 'DIGEST:%' AND created_at >= ${weekStart}
      LIMIT 1
    `);
    if (result.rows.length) return false;
    await tx.insert(notificationsTable).values({
      userId, type: "system", title, body, read: false, createdAt: now,
    });
    return true;
  }, { isolationLevel: "read committed" });
}
