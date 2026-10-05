/**
 * Weekly Digest
 *
 * Runs every Sunday at midnight (server time).
 * For every user who was active in the last 7 days, it computes:
 *   - posts created this week
 *   - new likes earned on any of their posts
 *   - new subscribers gained
 *   - current streak
 *   - peak trending rank achieved (top-10 velocity ranking)
 *   - total streak points
 *
 * Saves a single "system" notification per user.
 * The body is prefixed with `DIGEST:` followed by JSON so the frontend
 * can render it as a rich stat card instead of plain text.
 */

import { desc, sql, like } from "drizzle-orm";
import {
  db,
  notificationsTable,
  notificationPreferencesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./lib/logger";

export type DigestStats = {
  postsThisWeek: number;
  likesEarned: number;
  newSubscribers: number;
  currentStreak: number;
  totalPoints: number;
  peakRank: number | null;
};

// ── Scheduling state ────────────────────────────────────────────
let lastDigestRun: Date | null = null;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ─────────────────────────────────────────────────────

function daysSince(d: Date): number {
  return (Date.now() - d.getTime()) / 86_400_000;
}

async function loadLastRunFromDb(): Promise<void> {
  const [row] = await db
    .select({ createdAt: notificationsTable.createdAt })
    .from(notificationsTable)
    .where(like(notificationsTable.title, "%Weekly Digest%"))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(1);

  if (row) {
    lastDigestRun = new Date(row.createdAt);
    logger.info({ lastDigestRun }, "Weekly digest: last run loaded from DB");
  }
}

async function shouldNotify(userId: number): Promise<boolean> {
  const [prefs] = await db
    .select({ systemEnabled: notificationPreferencesTable.systemEnabled })
    .from(notificationPreferencesTable)
    .where(sql`${notificationPreferencesTable.userId} = ${userId}`);
  return prefs?.systemEnabled ?? true;
}

// ── Peak trending rank ───────────────────────────────────────────

async function getPeakRankByAuthor(): Promise<Map<number, number>> {
  const result = await db.execute(sql`
    SELECT
      p.author_id   AS "authorId",
      ROW_NUMBER() OVER (
        ORDER BY
          COUNT(DISTINCT rpl.id)::float /
          GREATEST(1.0, 1.0 + 0.3 * EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0)
          DESC,
          COUNT(DISTINCT pl.id) DESC
      )::int        AS rank
    FROM posts p
    LEFT JOIN post_likes pl  ON pl.post_id  = p.id
    LEFT JOIN post_likes rpl ON rpl.post_id = p.id
                             AND rpl.created_at > NOW() - INTERVAL '24 hours'
    WHERE p.created_at > NOW() - INTERVAL '7 days'
    GROUP BY p.id
    LIMIT 10
  `);

  const raw = result as unknown as { rows?: { authorId: number; rank: number }[] };
  const rows: { authorId: number; rank: number }[] = Array.isArray(result)
    ? (result as unknown as { authorId: number; rank: number }[])
    : (raw.rows ?? []);

  const map = new Map<number, number>();
  for (const r of rows) {
    const existing = map.get(r.authorId) ?? Infinity;
    if (r.rank < existing) map.set(r.authorId, r.rank);
  }
  return map;
}

// ── Main digest runner ──────────────────────────────────────────

export async function runWeeklyDigest(): Promise<void> {
  logger.info("Weekly digest: starting run");

  const [peakRankMap] = await Promise.all([getPeakRankByAuthor()]);

  // Per-user activity stats for the last 7 days
  const statsResult = await db.execute(sql`
    SELECT
      u.id                                       AS "userId",
      u.name,
      u.username,
      COUNT(DISTINCT new_p.id)::int              AS "postsThisWeek",
      COUNT(DISTINCT rl.id)::int                 AS "likesEarned",
      COUNT(DISTINCT s.id)::int                  AS "newSubscribers",
      COALESCE(MAX(st.current_streak), 0)::int   AS "currentStreak",
      COALESCE(MAX(st.total_points), 0)::float   AS "totalPoints"
    FROM users u
    LEFT JOIN posts new_p
      ON new_p.author_id = u.id
     AND new_p.created_at > NOW() - INTERVAL '7 days'
    LEFT JOIN posts all_p
      ON all_p.author_id = u.id
    LEFT JOIN post_likes rl
      ON rl.post_id = all_p.id
     AND rl.created_at > NOW() - INTERVAL '7 days'
    LEFT JOIN subscriptions s
      ON s.creator_id = u.id
     AND s.created_at > NOW() - INTERVAL '7 days'
    LEFT JOIN streaks st
      ON st.user_id = u.id
    GROUP BY u.id, u.name, u.username
    HAVING
      COUNT(DISTINCT new_p.id) > 0
      OR COUNT(DISTINCT rl.id) > 0
      OR COUNT(DISTINCT s.id) > 0
      OR COALESCE(MAX(st.current_streak), 0) > 0
  `);

  type StatRow = {
    userId: number;
    name: string | null;
    username: string | null;
    postsThisWeek: number;
    likesEarned: number;
    newSubscribers: number;
    currentStreak: number;
    totalPoints: number;
  };

  const rawStats = statsResult as unknown as { rows?: StatRow[] };
  const userStats: StatRow[] = Array.isArray(statsResult)
    ? (statsResult as unknown as StatRow[])
    : (rawStats.rows ?? []);

  // Also pull all user IDs so we can send to everyone (even inactive), if they have a streak
  const allUsers = await db
    .select({ id: usersTable.id, name: usersTable.name, username: usersTable.username })
    .from(usersTable);

  // Build a set of user IDs already covered by the activity query
  const coveredIds = new Set(userStats.map((r) => r.userId));

  // For inactive users with no activity, we still want to send a short digest
  const inactiveUsers: StatRow[] = allUsers
    .filter((u) => !coveredIds.has(u.id))
    .map((u) => ({
      userId: u.id,
      name: u.name,
      username: u.username,
      postsThisWeek: 0,
      likesEarned: 0,
      newSubscribers: 0,
      currentStreak: 0,
      totalPoints: 0,
    }));

  // Only send to active users (skip zero-activity inactive users)
  const recipients = userStats; // only those with at least some activity

  const weekLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let sent = 0;

  for (const row of recipients) {
    if (!(await shouldNotify(row.userId))) continue;

    const peakRank = peakRankMap.get(row.userId) ?? null;

    const stats: DigestStats = {
      postsThisWeek: row.postsThisWeek,
      likesEarned: row.likesEarned,
      newSubscribers: row.newSubscribers,
      currentStreak: row.currentStreak,
      totalPoints: row.totalPoints,
      peakRank,
    };

    const displayName = row.name ?? row.username ?? "Member";
    const highlights: string[] = [];
    if (row.postsThisWeek > 0) highlights.push(`${row.postsThisWeek} post${row.postsThisWeek !== 1 ? "s" : ""}`);
    if (row.likesEarned > 0) highlights.push(`${row.likesEarned} like${row.likesEarned !== 1 ? "s" : ""} earned`);
    if (row.newSubscribers > 0) highlights.push(`${row.newSubscribers} new subscriber${row.newSubscribers !== 1 ? "s" : ""}`);
    if (peakRank !== null) highlights.push(`#${peakRank} on Trending`);

    const summary = highlights.length > 0
      ? highlights.join(" · ")
      : "Keep posting to build your streak!";

    await db.insert(notificationsTable).values({
      userId: row.userId,
      type: "system",
      title: `Your week: ${weekLabel}`,
      body: `DIGEST:${JSON.stringify(stats)}`,
      read: false,
    });

    sent++;
    logger.info({ userId: row.userId, displayName, summary }, "Weekly digest: notification sent");
  }

  lastDigestRun = new Date();
  logger.info({ sent, week: weekLabel }, "Weekly digest: run complete");
}

// ── Scheduler ────────────────────────────────────────────────────

export async function scheduleWeeklyDigest(): Promise<void> {
  await loadLastRunFromDb();

  // Check immediately on startup whether we're overdue
  const isOverdue = lastDigestRun === null || daysSince(lastDigestRun) >= 6;
  const now = new Date();
  const isSunday = now.getDay() === 0;

  if (isSunday && isOverdue) {
    logger.info("Weekly digest: overdue on startup — running now");
    runWeeklyDigest().catch((e) => logger.error({ e }, "Weekly digest startup run failed"));
  }

  // Check every 30 minutes whether it's Sunday and we haven't run this week
  scheduleTimer = setInterval(
    () => {
      const d = new Date();
      const sunday = d.getDay() === 0;
      const midnight = d.getHours() === 0;
      const overdue = lastDigestRun === null || daysSince(lastDigestRun) >= 6;

      if (sunday && midnight && overdue) {
        logger.info("Weekly digest: Sunday midnight — running");
        runWeeklyDigest().catch((e) => logger.error({ e }, "Weekly digest scheduled run failed"));
      }
    },
    30 * 60 * 1000, // every 30 minutes
  );

  logger.info("Weekly digest: scheduler started (checks every 30 min)");
}
