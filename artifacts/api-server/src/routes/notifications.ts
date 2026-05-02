import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db,
  usersTable,
  notificationsTable,
  notificationPreferencesTable,
} from "@workspace/db";

const router: IRouter = Router();

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

async function ensurePrefs(userId: number) {
  const [existing] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(notificationPreferencesTable)
    .values({ userId })
    .returning();
  return created;
}

router.get("/notifications", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const user = await getUserByWallet(walletAddress);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const prefs = await ensurePrefs(user.id);

  const allNotifs = await db
    .select({
      id: notificationsTable.id,
      userId: notificationsTable.userId,
      type: notificationsTable.type,
      title: notificationsTable.title,
      body: notificationsTable.body,
      actorId: notificationsTable.actorId,
      resourceId: notificationsTable.resourceId,
      resourceType: notificationsTable.resourceType,
      read: notificationsTable.read,
      createdAt: notificationsTable.createdAt,
      actorName: usersTable.name,
      actorUsername: usersTable.username,
      actorAvatarUrl: usersTable.avatarUrl,
    })
    .from(notificationsTable)
    .leftJoin(usersTable, eq(usersTable.id, notificationsTable.actorId))
    .where(eq(notificationsTable.userId, user.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const filtered = allNotifs.filter((n) => {
    if (n.type === "like" && !prefs.likesEnabled) return false;
    if (n.type === "subscription" && !prefs.subscriptionsEnabled) return false;
    if (n.type === "badge" && !prefs.badgesEnabled) return false;
    if (n.type === "system" && !prefs.systemEnabled) return false;
    return true;
  });

  res.json({
    notifications: filtered,
    unreadCount: filtered.filter((n) => !n.read).length,
    preferences: {
      likesEnabled: prefs.likesEnabled,
      subscriptionsEnabled: prefs.subscriptionsEnabled,
      badgesEnabled: prefs.badgesEnabled,
      systemEnabled: prefs.systemEnabled,
    },
  });
});

router.post("/notifications/:notifId/read", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const user = await getUserByWallet(walletAddress);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const notifId = parseInt(req.params.notifId as string, 10);
  if (isNaN(notifId)) { res.status(400).json({ error: "Invalid notification id" }); return; }

  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.id, notifId), eq(notificationsTable.userId, user.id)));

  res.json({ success: true });
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const user = await getUserByWallet(walletAddress);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(eq(notificationsTable.userId, user.id));

  res.json({ success: true });
});

router.get("/notifications/preferences", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const user = await getUserByWallet(walletAddress);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const prefs = await ensurePrefs(user.id);
  res.json({
    likesEnabled: prefs.likesEnabled,
    subscriptionsEnabled: prefs.subscriptionsEnabled,
    badgesEnabled: prefs.badgesEnabled,
    systemEnabled: prefs.systemEnabled,
  });
});

router.put("/notifications/preferences", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const user = await getUserByWallet(walletAddress);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const { likesEnabled, subscriptionsEnabled, badgesEnabled, systemEnabled } = req.body as {
    likesEnabled?: boolean;
    subscriptionsEnabled?: boolean;
    badgesEnabled?: boolean;
    systemEnabled?: boolean;
  };

  await ensurePrefs(user.id);

  const updates: Record<string, boolean> = {};
  if (typeof likesEnabled === "boolean") updates.likesEnabled = likesEnabled;
  if (typeof subscriptionsEnabled === "boolean") updates.subscriptionsEnabled = subscriptionsEnabled;
  if (typeof badgesEnabled === "boolean") updates.badgesEnabled = badgesEnabled;
  if (typeof systemEnabled === "boolean") updates.systemEnabled = systemEnabled;

  const [updated] = await db
    .update(notificationPreferencesTable)
    .set(updates)
    .where(eq(notificationPreferencesTable.userId, user.id))
    .returning();

  res.json({
    likesEnabled: updated.likesEnabled,
    subscriptionsEnabled: updated.subscriptionsEnabled,
    badgesEnabled: updated.badgesEnabled,
    systemEnabled: updated.systemEnabled,
  });
});

export default router;
