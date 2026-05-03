import { Router, type IRouter } from "express";
import { eq, and, or } from "drizzle-orm";
import { db, usersTable, blockedUsersTable } from "@workspace/db";

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

// GET /api/users/blocked — list all users blocked by current user
router.get("/users/blocked", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(blockedUsersTable)
    .innerJoin(usersTable, eq(usersTable.id, blockedUsersTable.blockedUserId))
    .where(eq(blockedUsersTable.userId, me.id));

  res.json(rows);
});

// POST /api/users/block/:userId — block a user
router.post("/users/block/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const targetId = parseInt(req.params.userId, 10);
  if (isNaN(targetId) || targetId === me.id) { res.status(400).json({ error: "Invalid userId" }); return; }

  const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, targetId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  await db
    .insert(blockedUsersTable)
    .values({ userId: me.id, blockedUserId: targetId })
    .onConflictDoNothing();

  res.json({ blocked: true, userId: targetId });
});

// DELETE /api/users/block/:userId — unblock a user
router.delete("/users/block/:userId", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const targetId = parseInt(req.params.userId, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  await db
    .delete(blockedUsersTable)
    .where(and(eq(blockedUsersTable.userId, me.id), eq(blockedUsersTable.blockedUserId, targetId)));

  res.json({ blocked: false, userId: targetId });
});

// GET /api/users/:userId — check if the viewer has blocked this user
// (augments existing users route by checking block status when viewer wallet is present)
router.get("/users/:userId/block-status", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.json({ isBlocked: false, isBlockedBy: false }); return; }
  const me = await getUserByWallet(wallet);
  if (!me) { res.json({ isBlocked: false, isBlockedBy: false }); return; }

  const targetId = parseInt(req.params.userId, 10);
  if (isNaN(targetId)) { res.json({ isBlocked: false, isBlockedBy: false }); return; }

  const [row] = await db
    .select({ userId: blockedUsersTable.userId, blockedUserId: blockedUsersTable.blockedUserId })
    .from(blockedUsersTable)
    .where(
      or(
        and(eq(blockedUsersTable.userId, me.id), eq(blockedUsersTable.blockedUserId, targetId)),
        and(eq(blockedUsersTable.userId, targetId), eq(blockedUsersTable.blockedUserId, me.id)),
      ),
    );

  res.json({
    isBlocked: row ? row.userId === me.id : false,
    isBlockedBy: row ? row.blockedUserId === me.id : false,
  });
});

export default router;
