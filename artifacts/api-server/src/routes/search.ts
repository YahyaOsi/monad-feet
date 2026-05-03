import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.get("/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type : "all";

  if (!q || q.length < 1) {
    res.json({ users: [], posts: [], query: q });
    return;
  }

  // Cap at 100 chars to avoid wildcard abuse
  const safe = q.slice(0, 100);
  const pattern = `%${safe}%`;

  const doUsers = type === "all" || type === "users";
  const doPosts = type === "all" || type === "posts";

  const [usersResult, postsResult] = await Promise.all([
    doUsers
      ? db.execute(sql`
          SELECT
            u.id,
            u.name,
            u.username,
            u.avatar_url            AS "avatarUrl",
            u.bio,
            u.registration_tx_hash  AS "registrationTxHash",
            COALESCE(st.current_streak, 0)::int              AS "currentStreak",
            (
              SELECT COUNT(*)::int FROM subscriptions s
              WHERE s.creator_id = u.id AND s.expires_at > NOW()
            )                                                AS "subscriberCount",
            (
              SELECT COUNT(*)::int FROM posts p WHERE p.author_id = u.id
            )                                                AS "postCount"
          FROM users u
          LEFT JOIN streaks st ON st.user_id = u.id
          WHERE
            u.name     ILIKE ${pattern}
            OR u.username      ILIKE ${pattern}
            OR u.wallet_address ILIKE ${pattern}
          ORDER BY
            CASE WHEN u.username ILIKE ${`${safe}%`} THEN 0 ELSE 1 END,
            CASE WHEN u.name     ILIKE ${`${safe}%`} THEN 0 ELSE 1 END,
            "subscriberCount" DESC
          LIMIT 15
        `)
      : Promise.resolve(null),

    doPosts
      ? db.execute(sql`
          SELECT
            p.id,
            p.content,
            p.image_url          AS "imageUrl",
            p.author_id          AS "authorId",
            p.created_at         AS "createdAt",
            p.on_chain_tx_hash   AS "onChainTxHash",
            u.name               AS "authorName",
            u.username           AS "authorUsername",
            u.avatar_url         AS "authorAvatarUrl",
            COUNT(DISTINCT pl.id)::int AS "likeCount"
          FROM posts p
          LEFT JOIN users u        ON u.id = p.author_id
          LEFT JOIN post_likes pl  ON pl.post_id = p.id
          WHERE p.content ILIKE ${pattern}
          GROUP BY p.id, u.name, u.username, u.avatar_url
          ORDER BY "likeCount" DESC, p.created_at DESC
          LIMIT 15
        `)
      : Promise.resolve(null),
  ]);

  function extractRows<T>(result: unknown): T[] {
    if (!result) return [];
    const raw = result as { rows?: T[] };
    return Array.isArray(result) ? (result as T[]) : (raw.rows ?? []);
  }

  type UserRow = {
    id: number;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
    bio: string | null;
    registrationTxHash: string | null;
    currentStreak: number;
    subscriberCount: number;
    postCount: number;
  };

  type PostRow = {
    id: number;
    content: string | null;
    imageUrl: string | null;
    authorId: number;
    createdAt: unknown;
    onChainTxHash: string | null;
    authorName: string | null;
    authorUsername: string | null;
    authorAvatarUrl: string | null;
    likeCount: number;
  };

  const userRows = extractRows<UserRow>(usersResult);
  const postRows = extractRows<PostRow>(postsResult);

  const users = userRows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    avatarUrl: r.avatarUrl,
    bio: r.bio,
    registrationTxHash: r.registrationTxHash,
    currentStreak: r.currentStreak ?? 0,
    subscriberCount: r.subscriberCount ?? 0,
    postCount: r.postCount ?? 0,
  }));

  const posts = postRows.map((r) => ({
    id: r.id,
    content: r.content,
    imageUrl: r.imageUrl,
    authorId: r.authorId,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    onChainTxHash: r.onChainTxHash,
    authorName: r.authorName,
    authorUsername: r.authorUsername,
    authorAvatarUrl: r.authorAvatarUrl,
    likeCount: r.likeCount ?? 0,
  }));

  res.json({ users, posts, query: q });
});

export default router;
