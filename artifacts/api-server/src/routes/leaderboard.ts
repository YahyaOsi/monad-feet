import { Router, type IRouter } from "express";
import { sql, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

function getWalletAddress(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const addr = req.headers["x-wallet-address"];
  if (!addr) return null;
  return Array.isArray(addr) ? addr[0] : addr;
}

async function getUserByWallet(wallet: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, wallet.toLowerCase()));
  return user ?? null;
}

const router: IRouter = Router();

type SortBy = "points" | "subscribers" | "engagement" | "likes";
type Period = "alltime" | "weekly";

const VALID_SORT: Set<string> = new Set(["points", "subscribers", "engagement", "likes"]);
const VALID_PERIOD: Set<string> = new Set(["alltime", "weekly"]);

router.get("/leaderboard", async (req, res): Promise<void> => {
  const rawSort = typeof req.query.sortBy === "string" ? req.query.sortBy : "points";
  const rawPeriod = typeof req.query.period === "string" ? req.query.period : "alltime";

  const sortBy: SortBy = VALID_SORT.has(rawSort) ? (rawSort as SortBy) : "points";
  const period: Period = VALID_PERIOD.has(rawPeriod) ? (rawPeriod as Period) : "alltime";

  // For weekly period, constrain posts and likes to last 7 days
  const periodFilter = period === "weekly" ? sql`AND p.created_at > NOW() - INTERVAL '7 days'` : sql``;
  const likePeriodFilter = period === "weekly" ? sql`AND pl.created_at > NOW() - INTERVAL '7 days'` : sql``;

  // Build ORDER BY from sort key
  // Note: we use column aliases defined in the SELECT
  const orderExpr = (() => {
    switch (sortBy) {
      case "subscribers": return sql`"subscriberCount" DESC, "totalPoints" DESC, u.id ASC`;
      case "engagement":  return sql`"engagementScore" DESC, "totalPoints" DESC, u.id ASC`;
      case "likes":       return sql`"likeCount" DESC, "totalPoints" DESC, u.id ASC`;
      default:            return sql`"totalPoints" DESC, "engagementScore" DESC, u.id ASC`;
    }
  })();

  const result = await db.execute(sql`
    SELECT
      u.id                                                    AS "userId",
      u.name,
      u.username,
      u.avatar_url                                            AS "avatarUrl",
      u.registration_tx_hash                                  AS "registrationTxHash",
      COALESCE(st.total_points, 0)::float                     AS "totalPoints",
      COALESCE(st.current_streak, 0)::int                     AS "currentStreak",
      COALESCE(st.longest_streak, 0)::int                     AS "longestStreak",
      COUNT(DISTINCT p.id)::int                               AS "postCount",
      COUNT(DISTINCT pl.id)::int                              AS "likeCount",
      (
        SELECT COUNT(*)::int
        FROM subscriptions s
        WHERE s.creator_id = u.id
          AND s.expires_at > NOW()
      )                                                       AS "subscriberCount",
      (
        SELECT COUNT(*)::int FROM subscriptions s
        WHERE s.subscriber_id = u.id AND s.expires_at > NOW()
      )                                                       AS "subscriptionCount",
      (COUNT(DISTINCT pl.id) + COUNT(DISTINCT p.id) * 2)::int AS "engagementScore"
    FROM users u
    LEFT JOIN streaks st ON st.user_id = u.id
    LEFT JOIN posts p    ON p.author_id = u.id ${periodFilter}
    LEFT JOIN post_likes pl ON pl.post_id = p.id ${likePeriodFilter}
    GROUP BY
      u.id, u.name, u.username, u.avatar_url, u.registration_tx_hash,
      st.total_points, st.current_streak, st.longest_streak
    ORDER BY ${orderExpr}
    LIMIT 50
  `);

  const raw = result as unknown as { rows?: Record<string, unknown>[] };
  const rows: Record<string, unknown>[] = Array.isArray(result)
    ? (result as unknown as Record<string, unknown>[])
    : (raw.rows ?? []);

  const entries = rows.map((row, idx) => ({
    rank:               idx + 1,
    userId:             row.userId             as number,
    name:               (row.name              as string | null) ?? null,
    username:           (row.username          as string | null) ?? null,
    avatarUrl:          (row.avatarUrl         as string | null) ?? null,
    registrationTxHash: (row.registrationTxHash as string | null) ?? null,
    totalPoints:        (row.totalPoints       as number) ?? 0,
    currentStreak:      (row.currentStreak     as number) ?? 0,
    longestStreak:      (row.longestStreak     as number) ?? 0,
    postCount:          (row.postCount         as number) ?? 0,
    likeCount:          (row.likeCount         as number) ?? 0,
    subscriberCount:    (row.subscriberCount   as number) ?? 0,
    subscriptionCount:  (row.subscriptionCount as number) ?? 0,
    engagementScore:    (row.engagementScore   as number) ?? 0,
  }));

  // Match the shared API contract used by Discover and the leaderboard page.
  res.json(entries);
});

// ── GET /leaderboard/me ─────────────────────────────────────────
// Returns the authenticated user's rank, points, subscriber count,
// and total number of ranked users — works regardless of whether
// the user appears in the top-25 list.
router.get("/leaderboard/me", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(401).json({ error: "Unauthorized" }); return; }

  const currentUser = await getUserByWallet(walletAddress);
  if (!currentUser) { res.status(404).json({ error: "User not found" }); return; }
  const weekly = req.query.period === "weekly";
  const periodFilter = weekly ? sql`AND p.created_at > NOW() - INTERVAL '7 days'` : sql``;
  const likePeriodFilter = weekly ? sql`AND pl.created_at > NOW() - INTERVAL '7 days'` : sql``;

  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        u.id,
        u.name,
        u.username,
        u.avatar_url                                        AS "avatarUrl",
        COALESCE(st.total_points, 0)::float                 AS "totalPoints",
        COALESCE(st.current_streak, 0)::int                 AS "currentStreak",
        (
          SELECT COUNT(*)::int
          FROM subscriptions s
          WHERE s.creator_id = u.id AND s.expires_at > NOW()
        )                                                   AS "subscriberCount",
        ROW_NUMBER() OVER (
          ORDER BY COALESCE(st.total_points, 0) DESC,
            (
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id ${periodFilter}) * 2
              + (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id
                 WHERE p.author_id = u.id ${periodFilter} ${likePeriodFilter})
            ) DESC,
            u.id ASC
        )::int                                              AS rank,
        COUNT(*) OVER ()::int                               AS "totalUsers"
      FROM users u
      LEFT JOIN streaks st ON st.user_id = u.id
    )
    SELECT * FROM ranked WHERE id = ${currentUser.id}
  `);

  const raw = result as unknown as { rows?: Record<string, unknown>[] };
  const rows: Record<string, unknown>[] = Array.isArray(result)
    ? (result as unknown as Record<string, unknown>[])
    : (raw.rows ?? []);

  if (rows.length === 0) { res.status(404).json({ error: "No rank data" }); return; }

  const row = rows[0];
  res.json({
    userId:         currentUser.id,
    rank:           (row.rank           as number) ?? 0,
    totalUsers:     (row.totalUsers     as number) ?? 0,
    totalPoints:    (row.totalPoints    as number) ?? 0,
    currentStreak:  (row.currentStreak  as number) ?? 0,
    subscriberCount:(row.subscriberCount as number) ?? 0,
    name:           (row.name           as string | null) ?? null,
    username:       (row.username       as string | null) ?? null,
    avatarUrl:      (row.avatarUrl      as string | null) ?? null,
  });
});

export default router;
