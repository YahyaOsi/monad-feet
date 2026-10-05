import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, streaksTable, rewardClaimsTable } from "@workspace/db";
import { claimable, xTaskReward, utcDay } from "../reward-rules";

const router: IRouter = Router();
const lifetimeTasks = ["follow", "like", "comment", "notifications"] as const;
const postTask = "post_x";

async function currentUser(wallet: string) {
  const [user] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.walletAddress, wallet));
  return user;
}

router.get("/rewards/x", async (req, res): Promise<void> => {
  const user = await currentUser(req.headers["x-wallet-address"] as string);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const today = utcDay(new Date());
  const claims = await db.select().from(rewardClaimsTable).where(eq(rewardClaimsTable.userId, user.id));
  res.json({
    utcDay: today,
    lifetime: Object.fromEntries(lifetimeTasks.map(task => [task, claims.some(c => c.task === task)])),
    postClaimedToday: claims.some(c => c.task === postTask && c.dayKey === today),
    // Retain the response field for older clients; X tasks no longer grant invites.
    postStreakEligible: false,
  });
});

router.post("/rewards/x/:task", async (req, res): Promise<void> => {
  const task = req.params.task;
  if (task !== postTask && !lifetimeTasks.some(t => t === task)) {
    res.status(400).json({ error: "Unknown X task" }); return;
  }
  const user = await currentUser(req.headers["x-wallet-address"] as string);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const result = await db.transaction(async tx => {
    // All X claims for this account serialize, including across server instances.
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    const now = new Date();
    const dayKey = task === postTask ? utcDay(now) : "once";
    const [existing] = await tx.select({ id: rewardClaimsTable.id }).from(rewardClaimsTable)
      .where(and(eq(rewardClaimsTable.userId, user.id), eq(rewardClaimsTable.task, task), eq(rewardClaimsTable.dayKey, dayKey)));
    if (!claimable(existing ? dayKey : null, dayKey)) return { claimed: false, points: 0, invites: 0, utcDay: utcDay(now) };
    const reward = xTaskReward(task);
    await tx.insert(rewardClaimsTable).values({ userId: user.id, task, dayKey, ...reward });
    await tx.insert(streaksTable).values({ userId: user.id, totalPoints: reward.points })
      .onConflictDoUpdate({
        target: streaksTable.userId,
        set: { totalPoints: sql`${streaksTable.totalPoints} + ${reward.points}` },
      });
    return { claimed: true, ...reward, utcDay: utcDay(now) };
  });
  res.json(result);
});

export default router;