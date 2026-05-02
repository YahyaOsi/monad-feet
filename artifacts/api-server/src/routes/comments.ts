import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, commentsTable, postsTable, usersTable, notificationsTable, notificationPreferencesTable } from "@workspace/db";

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

async function shouldNotify(userId: number, type: string): Promise<boolean> {
  const [prefs] = await db.select().from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, userId));
  if (!prefs) return true;
  if (type === "comment") return prefs.likesEnabled;
  return true;
}

router.get("/posts/:postId/comments", async (req, res): Promise<void> => {
  const postId = parseInt(req.params.postId as string, 10);
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid post id" }); return; }

  const comments = await db
    .select({
      id: commentsTable.id,
      postId: commentsTable.postId,
      authorId: commentsTable.authorId,
      content: commentsTable.content,
      createdAt: commentsTable.createdAt,
      authorName: usersTable.name,
      authorUsername: usersTable.username,
      authorAvatarUrl: usersTable.avatarUrl,
    })
    .from(commentsTable)
    .leftJoin(usersTable, eq(usersTable.id, commentsTable.authorId))
    .where(eq(commentsTable.postId, postId))
    .orderBy(desc(commentsTable.createdAt));

  res.json(comments);
});

router.post("/posts/:postId/comments", async (req, res): Promise<void> => {
  const postId = parseInt(req.params.postId as string, 10);
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid post id" }); return; }

  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(401).json({ error: "Unauthorized" }); return; }

  const author = await getUserByWallet(walletAddress);
  if (!author) { res.status(404).json({ error: "User not found" }); return; }

  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) { res.status(400).json({ error: "Comment content is required" }); return; }
  if (content.length > 1000) { res.status(400).json({ error: "Comment too long (max 1000 chars)" }); return; }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }

  const [comment] = await db
    .insert(commentsTable)
    .values({ postId, authorId: author.id, content })
    .returning();

  if (post.authorId !== author.id && (await shouldNotify(post.authorId, "comment"))) {
    await db.insert(notificationsTable).values({
      userId: post.authorId,
      type: "like",
      title: "New comment on your post",
      body: `${author.name ?? author.username ?? "Someone"} commented: "${content.slice(0, 60)}${content.length > 60 ? "…" : ""}"`,
      actorId: author.id,
      resourceId: post.id,
      resourceType: "post",
      read: false,
    });
  }

  res.status(201).json({
    id: comment.id,
    postId: comment.postId,
    authorId: comment.authorId,
    content: comment.content,
    createdAt: comment.createdAt,
    authorName: author.name,
    authorUsername: author.username,
    authorAvatarUrl: author.avatarUrl,
  });
});

router.delete("/comments/:commentId", async (req, res): Promise<void> => {
  const commentId = parseInt(req.params.commentId as string, 10);
  if (isNaN(commentId)) { res.status(400).json({ error: "Invalid comment id" }); return; }

  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(401).json({ error: "Unauthorized" }); return; }

  const author = await getUserByWallet(walletAddress);
  if (!author) { res.status(404).json({ error: "User not found" }); return; }

  const [comment] = await db.select().from(commentsTable).where(eq(commentsTable.id, commentId));
  if (!comment) { res.status(404).json({ error: "Comment not found" }); return; }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, comment.postId));
  const canDelete = comment.authorId === author.id || post?.authorId === author.id;
  if (!canDelete) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(commentsTable).where(and(eq(commentsTable.id, commentId)));
  res.sendStatus(204);
});

export default router;
