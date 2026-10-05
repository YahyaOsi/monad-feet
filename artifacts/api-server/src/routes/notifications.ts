import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  notificationsTable,
  notificationPreferencesTable,
} from "@workspace/db";
import { buildNotificationQueries } from "../lib/notificationQueries";

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
    .onConflictDoNothing({ target: notificationPreferencesTable.userId })
    .returning();
  if (created) return created;
  const [concurrent] = await db.select().from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId));
  if (!concurrent) throw new Error("Notification preferences could not be loaded.");
  return concurrent;
}

router.get("/notifications", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const user = await getUserByWallet(walletAddress);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const prefs = await ensurePrefs(user.id);

  const queries = buildNotificationQueries(db, user.id, prefs);
  const [notifications, [unread]] = await Promise.all([queries.list, queries.unread]);

  res.json({
    notifications,
    unreadCount: unread.count,
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

  const rawId = Array.isArray(req.params.notifId) ? req.params.notifId[0] : req.params.notifId;
  const notifId = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(notifId) || notifId <= 0) {
    res.status(400).json({ error: "Invalid notification id" }); return;
  }

  const [updated] = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.id, notifId), eq(notificationsTable.userId, user.id)))
    .returning({ id: notificationsTable.id });
  if (!updated) { res.status(404).json({ error: "Notification not found" }); return; }

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
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide at least one notification preference." }); return;
  }

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
