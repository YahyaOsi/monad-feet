/**
 * Milestone badge engine.
 *
 * Call `checkMilestones(userId)` fire-and-forget after any event that
 * might push a user over a threshold. It:
 *   1. Fetches all relevant stats for the user in one SQL query.
 *   2. Compares against already-earned badge types.
 *   3. Inserts new badges + notifications for every newly crossed threshold.
 *   4. Broadcasts a `badge_earned` activity event via WebSocket so the
 *      congratulations toast appears instantly without a page refresh.
 */

import { eq, sql } from "drizzle-orm";
import {
  db,
  badgesTable,
  notificationsTable,
  notificationPreferencesTable,
} from "@workspace/db";
import { notifyUser } from "./presence";
import { logger } from "./lib/logger";

// ── Milestone definitions ────────────────────────────────────────

type MilestoneDef = {
  count: number;
  type: string;
  label: string;
  description: string;
  emoji: string;
};

const POST_MILESTONES: MilestoneDef[] = [
  { count: 1,  type: "first_post", label: "First Steps",     description: "Published your first post",   emoji: "🌱" },
  { count: 5,  type: "posts_5",    label: "Getting Started", description: "Published 5 posts",           emoji: "✍️" },
  { count: 10, type: "posts_10",   label: "Content Creator", description: "Published 10 posts",          emoji: "📸" },
  { count: 25, type: "posts_25",   label: "Prolific Poster", description: "Published 25 posts",          emoji: "🚀" },
  { count: 50, type: "posts_50",   label: "Monad Legend",    description: "Published 50 posts",          emoji: "🏆" },
];

const LIKES_MILESTONES: MilestoneDef[] = [
  { count: 10,  type: "likes_10",  label: "Getting Love",   description: "Received 10 total likes",     emoji: "❤️" },
  { count: 50,  type: "likes_50",  label: "Fan Favourite",  description: "Received 50 total likes",     emoji: "💖" },
  { count: 100, type: "likes_100", label: "Crowd Pleaser",  description: "Received 100 total likes",    emoji: "🌟" },
  { count: 500, type: "likes_500", label: "Viral",          description: "Received 500 total likes",    emoji: "⚡" },
];

const STREAK_MILESTONES: MilestoneDef[] = [
  { count: 3,  type: "streak_3",  label: "On a Roll",       description: "3-day check-in streak",      emoji: "🔥" },
  { count: 7,  type: "streak_7",  label: "Week Warrior",    description: "7-day check-in streak",      emoji: "🎯" },
  { count: 14, type: "streak_14", label: "Fortnight Force", description: "14-day check-in streak",     emoji: "💪" },
  { count: 30, type: "streak_30", label: "Monthly Master",  description: "30-day check-in streak",     emoji: "👑" },
];

const SUBSCRIBER_MILESTONES: MilestoneDef[] = [
  { count: 1,  type: "subs_1",  label: "First Fan",      description: "Got your first subscriber",    emoji: "🎉" },
  { count: 5,  type: "subs_5",  label: "Rising Creator", description: "Got 5 subscribers",            emoji: "📈" },
  { count: 10, type: "subs_10", label: "Creator Pro",    description: "Got 10 subscribers",           emoji: "🌈" },
  { count: 25, type: "subs_25", label: "Monad Star",     description: "Got 25 subscribers",           emoji: "⭐" },
];

// ── Stat fetch ───────────────────────────────────────────────────

type UserStats = {
  postCount: number;
  likesReceived: number;
  currentStreak: number;
  subscriberCount: number;
};

async function fetchStats(userId: number): Promise<UserStats> {
  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM posts         WHERE author_id = ${userId})::int        AS post_count,
      (SELECT COUNT(*) FROM post_likes pl
         JOIN posts p ON p.id = pl.post_id
        WHERE p.author_id = ${userId})::int                                        AS likes_received,
      COALESCE(
        (SELECT current_streak FROM streaks WHERE user_id = ${userId}), 0
      )::int                                                                       AS current_streak,
      (SELECT COUNT(*) FROM subscriptions
        WHERE creator_id = ${userId} AND expires_at > NOW())::int                 AS subscriber_count
  `);

  const raw = result as unknown as { rows?: Record<string, unknown>[] };
  const rows: Record<string, unknown>[] = Array.isArray(result)
    ? (result as unknown as Record<string, unknown>[])
    : (raw.rows ?? []);

  const row = rows[0] ?? {};
  return {
    postCount:       (row.post_count       as number) ?? 0,
    likesReceived:   (row.likes_received   as number) ?? 0,
    currentStreak:   (row.current_streak   as number) ?? 0,
    subscriberCount: (row.subscriber_count as number) ?? 0,
  };
}

// ── Main entry point ─────────────────────────────────────────────

export async function checkMilestones(userId: number): Promise<void> {
  try {
    const [stats, earnedRows, prefsRows] = await Promise.all([
      fetchStats(userId),
      db.select({ badgeType: badgesTable.badgeType })
        .from(badgesTable)
        .where(eq(badgesTable.userId, userId)),
      db.select({ badgesEnabled: notificationPreferencesTable.badgesEnabled })
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.userId, userId)),
    ]);

    const earnedSet = new Set(earnedRows.map((r) => r.badgeType));
    const badgesEnabled = prefsRows[0]?.badgesEnabled ?? true;

    // Collect newly crossed milestones
    const toAward: MilestoneDef[] = [];

    for (const m of POST_MILESTONES) {
      if (stats.postCount >= m.count && !earnedSet.has(m.type)) toAward.push(m);
    }
    for (const m of LIKES_MILESTONES) {
      if (stats.likesReceived >= m.count && !earnedSet.has(m.type)) toAward.push(m);
    }
    for (const m of STREAK_MILESTONES) {
      if (stats.currentStreak >= m.count && !earnedSet.has(m.type)) toAward.push(m);
    }
    for (const m of SUBSCRIBER_MILESTONES) {
      if (stats.subscriberCount >= m.count && !earnedSet.has(m.type)) toAward.push(m);
    }

    if (toAward.length === 0) return;

    // Award each milestone sequentially (avoid race inserts)
    for (const m of toAward) {
      await db.insert(badgesTable).values({
        userId,
        badgeType: m.type,
        label: m.label,
        description: m.description,
        // No creatorId — milestone badges are platform-issued
      });

      if (badgesEnabled) {
        await db.insert(notificationsTable).values({
          userId,
          type: "badge",
          title: `${m.emoji} Badge earned: ${m.label}`,
          body: m.description,
          resourceType: "badge",
          read: false,
        });
      }

      // Real-time WS alert to the user
      notifyUser(userId, {
        type: "badge_earned",
        userId,
        badge: { badgeType: m.type, label: m.label, description: m.description, emoji: m.emoji },
      });

      logger.info({ userId, badgeType: m.type, label: m.label }, "Milestone badge awarded");
    }
  } catch (e) {
    logger.error({ e, userId }, "checkMilestones error");
  }
}
