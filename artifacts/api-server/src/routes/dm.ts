import { Router, type IRouter } from "express";
import { eq, and, or, sql } from "drizzle-orm";
import { db, usersTable, directMessagesTable, subscriptionsTable, notificationsTable } from "@workspace/db";
import { notifyUser } from "../presence";

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

async function isSubscribedTo(subscriberId: number, creatorId: number): Promise<boolean> {
  const [sub] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.subscriberId, subscriberId),
        eq(subscriptionsTable.creatorId, creatorId),
        sql`${subscriptionsTable.expiresAt} > NOW()`,
      ),
    );
  return !!sub;
}

// PUT /api/dm/settings — toggle dmRequiresSubscription
// MUST be declared before /dm/:userId to avoid "settings" being parsed as a userId
router.put("/dm/settings", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }

  const dmRequiresSubscription = req.body?.dmRequiresSubscription;
  if (typeof dmRequiresSubscription !== "boolean") {
    res.status(400).json({ error: "dmRequiresSubscription must be a boolean" });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ dmRequiresSubscription })
    .where(eq(usersTable.walletAddress, wallet.toLowerCase()))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json({ dmRequiresSubscription: user.dmRequiresSubscription });
});

// GET /api/dm/conversations — list all conversations for current user
router.get("/dm/conversations", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db.execute(sql`
    WITH ranked AS (
      SELECT
        dm.*,
        CASE WHEN dm.sender_id = ${me.id} THEN dm.recipient_id ELSE dm.sender_id END AS other_id,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN dm.sender_id = ${me.id} THEN dm.recipient_id ELSE dm.sender_id END
          ORDER BY dm.created_at DESC
        ) AS rn
      FROM direct_messages dm
      WHERE dm.sender_id = ${me.id} OR dm.recipient_id = ${me.id}
    )
    SELECT
      r.other_id,
      r.content      AS last_content,
      r.sender_id    AS last_sender_id,
      r.created_at   AS last_at,
      u.name,
      u.username,
      u.avatar_url   AS "avatarUrl",
      u.dm_requires_subscription AS "dmRequiresSubscription",
      (
        SELECT COUNT(*)::int FROM direct_messages d2
        WHERE d2.sender_id = r.other_id
          AND d2.recipient_id = ${me.id}
          AND d2.read_at IS NULL
      ) AS unread_count
    FROM ranked r
    JOIN users u ON u.id = r.other_id
    WHERE r.rn = 1
    ORDER BY r.last_at DESC
  `);

  type Row = {
    other_id: number;
    last_content: string;
    last_sender_id: number;
    last_at: unknown;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
    dmRequiresSubscription: boolean;
    unread_count: number;
  };

  const raw = rows as unknown as { rows?: Row[] };
  const list: Row[] = Array.isArray(rows) ? (rows as unknown as Row[]) : (raw.rows ?? []);

  res.json(
    list.map((r) => ({
      userId: r.other_id,
      name: r.name,
      username: r.username,
      avatarUrl: r.avatarUrl,
      dmRequiresSubscription: r.dmRequiresSubscription,
      lastMessage: {
        content: r.last_content,
        sentByMe: r.last_sender_id === me.id,
        at: r.last_at instanceof Date ? r.last_at.toISOString() : String(r.last_at),
      },
      unreadCount: r.unread_count ?? 0,
    })),
  );
});

// GET /api/dm/:userId — fetch message thread with a user
router.get("/dm/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const otherId = parseInt(req.params.userId, 10);
  if (isNaN(otherId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  const [other] = await db.select().from(usersTable).where(eq(usersTable.id, otherId));
  if (!other) { res.status(404).json({ error: "User not found" }); return; }

  if (other.dmRequiresSubscription && me.id !== otherId) {
    const subscribed = await isSubscribedTo(me.id, otherId);
    if (!subscribed) {
      res.status(403).json({
        error: "subscription_required",
        message: `${other.name ?? other.username ?? "This user"} requires a subscription to receive DMs.`,
        creatorId: otherId,
        creatorName: other.name,
        creatorUsername: other.username,
        subscriptionPrice: other.subscriptionPrice ? Number(other.subscriptionPrice) : null,
      });
      return;
    }
  }

  const messages = await db
    .select()
    .from(directMessagesTable)
    .where(
      or(
        and(eq(directMessagesTable.senderId, me.id), eq(directMessagesTable.recipientId, otherId)),
        and(eq(directMessagesTable.senderId, otherId), eq(directMessagesTable.recipientId, me.id)),
      ),
    )
    .orderBy(directMessagesTable.createdAt);

  await db
    .update(directMessagesTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(directMessagesTable.senderId, otherId),
        eq(directMessagesTable.recipientId, me.id),
        sql`${directMessagesTable.readAt} IS NULL`,
      ),
    );

  res.json({
    otherUser: {
      id: other.id,
      name: other.name,
      username: other.username,
      avatarUrl: other.avatarUrl,
      dmRequiresSubscription: other.dmRequiresSubscription,
      subscriptionPrice: other.subscriptionPrice ? Number(other.subscriptionPrice) : null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      content: m.content,
      sentByMe: m.senderId === me.id,
      readAt: m.readAt ? (m.readAt instanceof Date ? m.readAt.toISOString() : String(m.readAt)) : null,
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
    })),
  });
});

// POST /api/dm/:userId — send a message
router.post("/dm/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const otherId = parseInt(req.params.userId, 10);
  if (isNaN(otherId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  if (otherId === me.id) { res.status(400).json({ error: "Cannot message yourself" }); return; }

  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content || content.length === 0) { res.status(400).json({ error: "Message cannot be empty" }); return; }
  if (content.length > 2000) { res.status(400).json({ error: "Message too long (max 2000 chars)" }); return; }

  const [other] = await db.select().from(usersTable).where(eq(usersTable.id, otherId));
  if (!other) { res.status(404).json({ error: "Recipient not found" }); return; }

  if (other.dmRequiresSubscription) {
    const subscribed = await isSubscribedTo(me.id, otherId);
    if (!subscribed) {
      res.status(403).json({
        error: "subscription_required",
        message: `${other.name ?? other.username ?? "This user"} requires a subscription to receive DMs.`,
        creatorId: otherId,
        subscriptionPrice: other.subscriptionPrice ? Number(other.subscriptionPrice) : null,
      });
      return;
    }
  }

  const [msg] = await db
    .insert(directMessagesTable)
    .values({ senderId: me.id, recipientId: otherId, content })
    .returning();

  notifyUser(otherId, {
    type: "new_dm",
    messageId: msg.id,
    senderId: me.id,
    senderName: me.name ?? me.username ?? null,
    senderAvatarUrl: me.avatarUrl ?? null,
    preview: content.slice(0, 80),
  });

  await db.insert(notificationsTable).values({
    userId: otherId,
    type: "dm",
    title: `New message from ${me.name ?? me.username ?? "Someone"}`,
    body: content.slice(0, 120),
    actorId: me.id,
    resourceType: "dm",
    read: false,
  });

  res.status(201).json({
    id: msg.id,
    content: msg.content,
    sentByMe: true,
    readAt: null,
    createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
  });
});

export default router;
