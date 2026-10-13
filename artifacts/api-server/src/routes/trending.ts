import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, postLikesTable, usersTable } from "@workspace/db";
import { reconcilePostProofs } from "../lib/socialChain";

const router: IRouter = Router();

function getWalletAddress(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const addr = req.headers["x-wallet-address"];
  if (!addr) return null;
  return Array.isArray(addr) ? addr[0] : addr;
}

async function getUserByWallet(wallet: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet.toLowerCase()));
  return user ?? null;
}

router.get("/trending", async (req, res): Promise<void> => {
  await reconcilePostProofs();
  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;

  // Velocity formula: recent_likes / (1 + age_hours * 0.3)
  // Only posts from the last 7 days; recent = likes in last 24h
  const result = await db.execute(sql`
    SELECT
      p.id,
      p.content,
      p.image_url            AS "imageUrl",
      p.author_id            AS "authorId",
      p.on_chain_tx_hash     AS "onChainTxHash",
      p.created_at           AS "createdAt",
      u.name                 AS "authorName",
      u.username             AS "authorUsername",
      u.avatar_url           AS "authorAvatarUrl",
      COUNT(DISTINCT pl.user_id)::int                                         AS "likeCount",
      COUNT(DISTINCT rpl.user_id)::int                                        AS "recentLikes",
      ROUND(
        (COUNT(DISTINCT rpl.user_id)::float /
         GREATEST(1.0, 1.0 + 0.3 * EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0)
        )::numeric, 4
      )::float                                                                AS "velocity"
    FROM posts p
    LEFT JOIN users u   ON u.id = p.author_id
    LEFT JOIN post_likes pl  ON pl.post_id  = p.id AND pl.chain_verified_at IS NOT NULL
    LEFT JOIN post_likes rpl ON rpl.post_id = p.id
                            AND rpl.chain_verified_at IS NOT NULL
                            AND rpl.created_at > NOW() - INTERVAL '24 hours'
    WHERE p.created_at > NOW() - INTERVAL '7 days' AND p.chain_verified_at IS NOT NULL
    GROUP BY p.id, u.name, u.username, u.avatar_url
    ORDER BY "velocity" DESC, "likeCount" DESC
    LIMIT 30
  `);
  // drizzle-orm postgres returns QueryResult; rows live under .rows
  const raw = result as unknown as { rows?: Record<string, unknown>[] };
  const rows: Record<string, unknown>[] = Array.isArray(result)
    ? (result as unknown as Record<string, unknown>[])
    : (raw.rows ?? []);

  const postIds = (rows as { id: number }[]).map((r) => r.id);
  let likedSet = new Set<number>();

  if (currentUser && postIds.length > 0) {
    const likes = await db
      .select({ postId: postLikesTable.postId })
      .from(postLikesTable)
      .where(eq(postLikesTable.userId, currentUser.id));
    likedSet = new Set(likes.map((l) => l.postId));
  }

  const posts = (rows as Record<string, unknown>[]).map((row, idx) => ({
    id: row.id as number,
    rank: idx + 1,
    velocity: row.velocity as number,
    recentLikes: row.recentLikes as number,
    likeCount: row.likeCount as number,
    content: (row.content as string | null) ?? null,
    imageUrl: (row.imageUrl as string | null) ?? null,
    authorId: row.authorId as number,
    authorName: (row.authorName as string | null) ?? null,
    authorUsername: (row.authorUsername as string | null) ?? null,
    authorAvatarUrl: (row.authorAvatarUrl as string | null) ?? null,
    onChainTxHash: (row.onChainTxHash as string | null) ?? null,
    likedByMe: likedSet.has(row.id as number),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }));

  res.json({ posts, generatedAt: new Date().toISOString() });
});

export default router;
