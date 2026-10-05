import { Router, type IRouter, type RequestHandler } from "express";
import { eq, and, or, sql } from "drizzle-orm";
import { db, usersTable, directMessagesTable, notificationsTable, mutedUsersTable, blockedUsersTable } from "@workspace/db";
import { canReadCreator, verifiedCreatorIds } from "../lib/contentPrivacy";
import { conversationListQuery, hideConversationQuery, notifyDmParticipants, parseDmUserId } from "../lib/dmConversations";

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
  return canReadCreator(subscriberId, creatorId);
}

// ── Mute endpoints (must be before /:userId) ─────────────────────

// GET /api/dm/muted — list muted user IDs for current user
router.get("/dm/muted", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db
    .select({ mutedUserId: mutedUsersTable.mutedUserId })
    .from(mutedUsersTable)
    .where(eq(mutedUsersTable.userId, me.id));

  res.json(rows.map((r) => r.mutedUserId));
});

// POST /api/dm/mute/:userId — mute a user
router.post("/dm/mute/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const targetId = parseDmUserId(req.params.userId);
  if (targetId === null || targetId === me.id) { res.status(400).json({ error: "Invalid userId" }); return; }

  await db
    .insert(mutedUsersTable)
    .values({ userId: me.id, mutedUserId: targetId })
    .onConflictDoNothing();

  res.json({ muted: true, userId: targetId });
});

// DELETE /api/dm/mute/:userId — unmute a user
router.delete("/dm/mute/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const targetId = parseDmUserId(req.params.userId);
  if (targetId === null) { res.status(400).json({ error: "Invalid userId" }); return; }

  await db
    .delete(mutedUsersTable)
    .where(and(eq(mutedUsersTable.userId, me.id), eq(mutedUsersTable.mutedUserId, targetId)));

  res.json({ muted: false, userId: targetId });
});

// PUT /api/dm/settings — toggle dmRequiresSubscription (before /:userId)
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

// GET /api/dm/conversations — list all conversations, with isMuted flag
router.get("/dm/conversations", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db.execute(conversationListQuery(me.id));

  type Row = {
    other_id: number;
    last_content: string;
    last_sender_id: number;
    last_at: unknown;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
    dmRequiresSubscription: boolean;
    isMuted: boolean;
    isBlocked: boolean;
    unread_count: number;
  };

  const raw = rows as unknown as { rows?: Row[] };
  const list: Row[] = Array.isArray(rows) ? (rows as unknown as Row[]) : (raw.rows ?? []);
  const subscribed = await verifiedCreatorIds(me.id);

  res.json(
    list.map((r) => ({
      userId: r.other_id,
      name: r.name,
      username: r.username,
      avatarUrl: r.avatarUrl,
      dmRequiresSubscription: r.dmRequiresSubscription,
      isMuted: r.isMuted ?? false,
      isBlocked: r.isBlocked ?? false,
      lastMessage: {
        content: r.dmRequiresSubscription && !subscribed.has(r.other_id) ? "" : r.last_content,
        sentByMe: r.last_sender_id === me.id,
        at: r.last_at instanceof Date ? r.last_at.toISOString() : String(r.last_at),
      },
      unreadCount: r.unread_count ?? 0,
    })),
  );
});

// DELETE /api/dm/conversations/:userId — hide only my inbox entry, not history.
// Requires protectApi's signed session and same-origin checks like all DM routes.
router.delete("/dm/conversations/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const otherId = parseDmUserId(req.params.userId);
  if (otherId === null || otherId === me.id) { res.status(400).json({ error: "Invalid userId" }); return; }
  const [other] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, otherId));
  if (!other) { res.status(404).json({ error: "User not found" }); return; }

  // Idempotent even for a missing/already-hidden conversation. No entitlement
  // needed to remove one's own inbox entry, and no other pair can be modified.
  await db.execute(hideConversationQuery(me.id, otherId));
  res.json({ deleted: true, userId: otherId });
});

// GET /api/dm/:userId — fetch thread, with isMuted & isBlocked on otherUser
router.get("/dm/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const otherId = parseDmUserId(req.params.userId);
  if (otherId === null) { res.status(400).json({ error: "Invalid userId" }); return; }

  const [other] = await db.select().from(usersTable).where(eq(usersTable.id, otherId));
  if (!other) { res.status(404).json({ error: "User not found" }); return; }

  // Check block status (either direction)
  const [blocked] = await db
    .select({ id: blockedUsersTable.id })
    .from(blockedUsersTable)
    .where(
      or(
        and(eq(blockedUsersTable.userId, me.id), eq(blockedUsersTable.blockedUserId, otherId)),
        and(eq(blockedUsersTable.userId, otherId), eq(blockedUsersTable.blockedUserId, me.id)),
      ),
    );

  const [muted] = await db
    .select({ id: mutedUsersTable.id })
    .from(mutedUsersTable)
    .where(and(eq(mutedUsersTable.userId, me.id), eq(mutedUsersTable.mutedUserId, otherId)));

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
    .orderBy(directMessagesTable.createdAt, directMessagesTable.id);

  if (!blocked) {
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
  }

  res.json({
    otherUser: {
      id: other.id,
      name: other.name,
      username: other.username,
      avatarUrl: other.avatarUrl,
      dmRequiresSubscription: other.dmRequiresSubscription,
      subscriptionPrice: other.subscriptionPrice ? Number(other.subscriptionPrice) : null,
      isMuted: !!muted,
      isBlocked: !!blocked,
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

// POST /api/dm/:userId — send a message (blocked check)
export function createSendDmHandler(notifyParticipants: typeof notifyDmParticipants = notifyDmParticipants): RequestHandler {
  return async (req, res): Promise<void> => {
    const wallet = getWalletAddress(req);
    if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
    const me = await getUserByWallet(wallet);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const otherId = parseDmUserId(req.params.userId);
    if (otherId === null) { res.status(400).json({ error: "Invalid userId" }); return; }
    if (otherId === me.id) { res.status(400).json({ error: "Cannot message yourself" }); return; }

    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content || content.length === 0) { res.status(400).json({ error: "Message cannot be empty" }); return; }
    if (content.length > 2000) { res.status(400).json({ error: "Message too long (max 2000 chars)" }); return; }

    const [other] = await db.select().from(usersTable).where(eq(usersTable.id, otherId));
    if (!other) { res.status(404).json({ error: "Recipient not found" }); return; }

    // Block check — either direction
    const [blocked] = await db
      .select({ id: blockedUsersTable.id })
      .from(blockedUsersTable)
      .where(
        or(
          and(eq(blockedUsersTable.userId, me.id), eq(blockedUsersTable.blockedUserId, otherId)),
          and(eq(blockedUsersTable.userId, otherId), eq(blockedUsersTable.blockedUserId, me.id)),
        ),
      );

    if (blocked) {
      res.status(403).json({ error: "blocked", message: "Cannot send messages to this user." });
      return;
    }

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

    // A failed notification write must not leave a message behind for a retry
    // to duplicate. Realtime listeners only refetch after both writes commit.
    const msg = await db.transaction(async tx => {
      const [message] = await tx
        .insert(directMessagesTable)
        .values({ senderId: me.id, recipientId: otherId, content })
        .returning();

      await tx.insert(notificationsTable).values({
        userId: otherId,
        type: "dm",
        title: `New message from ${me.name ?? me.username ?? "Someone"}`,
        body: content.slice(0, 120),
        actorId: me.id,
        resourceType: "dm",
        read: false,
      });
      return message;
    });

    notifyParticipants(me.id, otherId, {
      type: "new_dm",
      messageId: msg.id,
      senderId: me.id,
      senderName: me.name ?? me.username ?? null,
      senderAvatarUrl: me.avatarUrl ?? null,
      preview: content.slice(0, 80),
    });

    res.status(201).json({
      id: msg.id,
      content: msg.content,
      sentByMe: true,
      readAt: null,
      createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
    });
  };
}

router.post("/dm/:userId", createSendDmHandler());

export default router;
