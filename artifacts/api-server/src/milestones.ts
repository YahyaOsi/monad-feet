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
  inviteCodesTable,
} from "@workspace/db";
import { notifyUser } from "./presence";
import { logger } from "./lib/logger";
import { nanoid } from "nanoid";

// ── Invite code award helper ─────────────────────────────────────

async function awardInviteCodes(userId: number, count: number): Promise<void> {
  const codes = Array.from({ length: count }, () => ({
    code: nanoid(8).toUpperCase(),
    ownerId: userId,
  }));
  await db.insert(inviteCodesTable).values(codes);
  logger.info({ userId, count }, "Invite codes awarded");
}

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

// Invite code awards — tracked via a hidden badge type so they only fire once.
// `codes` = how many invite codes to grant when this threshold is first crossed.
type InviteAwardDef = {
  stat: "streak" | "posts";
  count: number;
  type: string; // unique badge-type marker
  codes: number;
  reason: string;
};

const INVITE_AWARDS: InviteAwardDef[] = [
  { stat: "streak", count: 7,  type: "icm_streak_7",  codes: 1, reason: "7-day check-in streak" },
  { stat: "streak", count: 30, type: "icm_streak_30", codes: 3, reason: "30-day check-in streak" },
  { stat: "posts",  count: 10, type: "icm_posts_10",  codes: 1, reason: "publishing 10 posts" },
  { stat: "posts",  count: 25, type: "icm_posts_25",  codes: 1, reason: "publishing 25 posts" },
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

    // Check invite code awards (use earnedSet for deduplication)
    const inviteAwards: InviteAwardDef[] = [];
    for (const award of INVITE_AWARDS) {
      const statValue = award.stat === "streak" ? stats.currentStreak : stats.postCount;
      if (statValue >= award.count && !earnedSet.has(award.type)) {
        inviteAwards.push(award);
      }
    }

    if (toAward.length === 0 && inviteAwards.length === 0) return;

    // Grant invite codes first (fire-and-forget per award)
    for (const award of inviteAwards) {
      // Insert a hidden marker badge so we never double-award
      await db.insert(badgesTable).values({
        userId,
        badgeType: award.type,
        label: `Invite codes: ${award.reason}`,
        description: `Earned ${award.codes} invite code${award.codes > 1 ? "s" : ""} for ${award.reason}`,
      });
      await awardInviteCodes(userId, award.codes);
      if (badgesEnabled) {
        await db.insert(notificationsTable).values({
          userId,
          type: "system",
          title: `🎟️ You earned ${award.codes} invite code${award.codes > 1 ? "s" : ""}!`,
          body: `Reward for ${award.reason}. Find your codes in the Wallet tab.`,
          resourceType: "invite",
          read: false,
        });
      }
      notifyUser(userId, { type: "invite_codes_earned", userId, codes: award.codes, reason: award.reason });
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
