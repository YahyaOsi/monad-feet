import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, streaksTable, rewardClaimsTable } from "@workspace/db";
import { dailyBonusTask } from "../lib/dailyBonusRules";
import { utcDay } from "../reward-rules";
import { REGISTRY } from "../lib/chainConfig";

const router = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function status(tx: Tx, userId: number, now: Date) {
  const task = dailyBonusTask(now);
  const dayKey = utcDay(now);
  const start = new Date(`${dayKey}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const uid = userId;
  let query;
  switch (task.id) {
    case "checkin":
      query = sql`select count(*)::int as n from chain_reward_claims where user_id=${uid} and kind='checkin' and contract_address=${REGISTRY.toLowerCase()} and block_timestamp >= ${start} and block_timestamp < ${end}`; break;
    case "post":
      query = sql`select (select count(*) from posts where author_id=${uid} and created_at>=${start} and created_at<${end})::int + (select count(*) from private_posts where creator_id=${uid} and created_at>=${start} and created_at<${end})::int as n`; break;
    case "photo":
      query = sql`select count(*)::int as n from posts where author_id=${uid} and is_paid=false and created_at>=${start} and created_at<${end} and image_url is not null`; break;
    case "subscribe":
      query = sql`select count(*)::int as n from subscription_payments p join subscriptions s on lower(s.tx_hash)=p.tx_hash and s.subscriber_id=p.subscriber_id and s.creator_id=p.creator_id where p.subscriber_id=${uid} and s.creator_id<>${uid} and s.price_per_month>0 and s.expires_at>${now} and p.created_at>=${start} and p.created_at<${end}`; break;
    case "exclusive":
      query = sql`select (select count(*) from private_posts where creator_id=${uid} and created_at>=${start} and created_at<${end})::int + (select count(*) from posts where author_id=${uid} and is_paid=true and created_at>=${start} and created_at<${end})::int as n`; break;
    case "likes": case "support":
      query = sql`select count(distinct l.post_id)::int as n from post_likes l join posts p on p.id=l.post_id where l.user_id=${uid} and p.author_id<>${uid} and l.created_at>=${start} and l.created_at<${end}`; break;
    case "reply":
      query = sql`select count(*)::int as n from comments c join comments parent on parent.id=c.parent_comment_id where c.author_id=${uid} and parent.author_id<>${uid} and c.created_at>=${start} and c.created_at<${end}`; break;
    case "comment": case "discuss":
      query = sql`select count(distinct c.post_id)::int as n from comments c join posts p on p.id=c.post_id where c.author_id=${uid} and p.author_id<>${uid} and c.created_at>=${start} and c.created_at<${end}`; break;
    case "invite":
      query = sql`select count(distinct u.id)::int as n from invite_codes i join users u on u.id=i.used_by_id where i.owner_id=${uid} and u.id<>${uid} and u.created_at>=${start} and u.created_at<${end}`; break;
    case "spa":
      query = sql`select count(*)::int as n from chain_reward_claims where user_id=${uid} and kind='game' and contract_address=${REGISTRY.toLowerCase()} and block_timestamp>=${start} and block_timestamp<${end}`; break;
  }
  const rows = await tx.execute(query);
  const progress = Math.min(task.target, Number(rows.rows[0]?.n ?? 0));
  const [claim] = await tx.select().from(rewardClaimsTable).where(and(
    eq(rewardClaimsTable.userId, uid), eq(rewardClaimsTable.task, "dailyBonus"), eq(rewardClaimsTable.dayKey, dayKey)));
  return { utcDay: dayKey, nextResetAt: end.toISOString(), task, progress, eligible: progress >= task.target, claimed: !!claim };
}

router.route("/rewards/daily").get(async (req, res) => {
  const wallet = String(req.headers["x-wallet-address"] ?? "").toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet));
  if (!user) { res.status(401).json({ error: "Sign in to see your daily task" }); return; }
  res.json(await db.transaction(tx => status(tx, user.id, new Date())));
}).post(async (req, res) => {
  const wallet = String(req.headers["x-wallet-address"] ?? "").toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet));
  if (!user) { res.status(401).json({ error: "Sign in to claim your daily task" }); return; }
  const result = await db.transaction(async tx => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    const current = await status(tx, user.id, new Date());
    if (current.claimed || !current.eligible) return current;
    await tx.insert(rewardClaimsTable).values({ userId: user.id, task: "dailyBonus", dayKey: current.utcDay, points: current.task.points, invites: 0 });
    await tx.insert(streaksTable).values({ userId: user.id, totalPoints: current.task.points })
      .onConflictDoUpdate({ target: streaksTable.userId, set: { totalPoints: sql`${streaksTable.totalPoints} + ${current.task.points}` } });
    return { ...current, claimed: true };
  });
  res.status(!result.claimed && !result.eligible ? 409 : 200).json(result);
});
export default router;
