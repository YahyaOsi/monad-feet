import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, inviteCodesTable, usersTable } from "@workspace/db";
import { ValidateInviteCodeBody } from "@workspace/api-zod";
import { isInviteUsed } from "../lib/inviteCodes";

const router: IRouter = Router();

function getWalletAddress(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const addr = req.headers["x-wallet-address"];
  if (!addr) return null;
  return Array.isArray(addr) ? addr[0] : addr;
}

router.get("/invites", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) {
    res.status(400).json({ error: "Missing x-wallet-address header" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, walletAddress.toLowerCase()));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const codes = await db
    .select({
      id: inviteCodesTable.id,
      code: inviteCodesTable.code,
      usedById: inviteCodesTable.usedById,
      usedAt: inviteCodesTable.usedAt,
      createdAt: inviteCodesTable.createdAt,
      usedByUsername: usersTable.username,
    })
    .from(inviteCodesTable)
    .leftJoin(usersTable, eq(usersTable.id, inviteCodesTable.usedById))
    .where(eq(inviteCodesTable.ownerId, user.id));

  res.json(
    codes.map((c) => ({
      id: c.id,
      code: c.code,
      used: isInviteUsed(c),
      usedByUsername: c.usedByUsername ?? null,
      createdAt: c.createdAt,
    }))
  );
});

router.post("/invites/validate", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = ValidateInviteCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [invite] = await db
    .select()
    .from(inviteCodesTable)
    .where(eq(inviteCodesTable.code, parsed.data.code.trim().toUpperCase()));

  if (!invite) {
    res.json({ valid: false, message: "Invalid invite code" });
    return;
  }

  if (isInviteUsed(invite)) {
    res.json({ valid: false, message: "Invite code already used" });
    return;
  }

  res.json({ valid: true, message: "Valid invite code" });
});

export default router;
