import { and, eq, desc, or, sql } from "drizzle-orm";
import { formatEther } from "viem";
import { db, creatorMemberships, creatorSubmissions, creatorTasks, creatorWeeks, creatorAllocations, creatorAudit, usersTable, verifiedRegistrationsTable, type CreatorWorkspace, type CreatorSubmission } from "@workspace/db";
import { weekFor, SAMPLE_POOL_WEI } from "./config";
import { accountView, primaryMember, actorFor, type Transaction } from "./session";
import { getTreasuryBalance } from "./treasury";

export async function tasksFor(ws: CreatorWorkspace) {
  return db.select().from(creatorTasks).where(eq(creatorTasks.workspaceId, ws.id)).orderBy(creatorTasks.rowId);
}
export function submissionView(s: CreatorSubmission, creatorName: string) {
  return { ...s, creatorName, createdAt: s.createdAt.toISOString(), reviewedAt: s.reviewedAt?.toISOString() ?? null };
}
export async function submissionsFor(ws: CreatorWorkspace, all = false) {
  const rows = await db.select({ submission: creatorSubmissions, name: creatorMemberships.name }).from(creatorSubmissions)
    .innerJoin(creatorMemberships, eq(creatorMemberships.id, creatorSubmissions.memberId))
    .where(and(eq(creatorSubmissions.workspaceId, ws.id), all ? undefined : eq(creatorSubmissions.memberId, ws.primaryMemberId!)))
    .orderBy(desc(creatorSubmissions.createdAt), desc(creatorSubmissions.id));
  return rows.map((r) => submissionView(r.submission, r.name));
}
export async function scoresFor(ws: CreatorWorkspace, weekStart?: string, tx: Transaction | typeof db = db) {
  const members = ws.mode === "demo" ?
    await tx.select().from(creatorMemberships).where(eq(creatorMemberships.workspaceId, ws.id)) :
    (await tx.select({ member: creatorMemberships, user: usersTable }).from(creatorMemberships)
      .innerJoin(usersTable, eq(usersTable.id, creatorMemberships.mainUserId))
      .innerJoin(verifiedRegistrationsTable, and(eq(verifiedRegistrationsTable.userId, usersTable.id),
        sql`${verifiedRegistrationsTable.txHash} = lower(${usersTable.registrationTxHash})`))
      .where(eq(creatorMemberships.workspaceId, ws.id)))
      .map(({ member, user }) => ({ ...member, name: user.name ?? user.username ?? "Monad Feet member", handle: user.username ?? "", wallet: user.walletAddress }));
  const submissions = await tx.select().from(creatorSubmissions).where(and(
    eq(creatorSubmissions.workspaceId, ws.id), eq(creatorSubmissions.status, "approved"),
    weekStart ? eq(creatorSubmissions.weekStart, weekStart) : undefined,
  ));
  return members.filter((m) => m.status === "approved").map((member) => {
    const own = submissions.filter((s) => s.memberId === member.id);
    return { id: member.id, member, score: own.reduce((sum, s) => sum + s.score, 0), contributions: own.length };
  }).sort((a, b) => b.score - a.score || a.id - b.id);
}
export async function leaderboardFor(ws: CreatorWorkspace) {
  const scores = await scoresFor(ws, weekFor().weekStart);
  const treasury = ws.mode === "wallet" ? await getTreasuryBalance() : null;
  const pool = ws.mode === "demo" ? SAMPLE_POOL_WEI : treasury?.poolWei ? BigInt(treasury.poolWei) : null;
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  let rank = 0;
  let last = -1;
  return scores.map((s, i) => {
    if (s.score !== last) rank = i + 1;
    last = s.score;
    return { id: s.id, rank, name: s.member.name, handle: s.member.handle, score: s.score, contributions: s.contributions,
      estimatedMonWei: pool === null ? null : total ? (pool * BigInt(s.score) / BigInt(total)).toString() : "0",
      isYou: s.id === ws.primaryMemberId, mode: ws.mode };
  });
}
export async function rewardsFor(ws: CreatorWorkspace, all = false) {
  const rewards = await db.select({ allocation: creatorAllocations, week: creatorWeeks }).from(creatorAllocations)
    .innerJoin(creatorWeeks, eq(creatorWeeks.id, creatorAllocations.weekId))
    .where(and(eq(creatorAllocations.workspaceId, ws.id), all ? undefined : eq(creatorAllocations.memberId, ws.primaryMemberId!)))
    .orderBy(desc(creatorWeeks.weekStart), creatorAllocations.memberId);
  return rewards.map(({ allocation: a, week: w }) => ({
    id: a.id, memberId: a.memberId, creatorName: a.creatorName, weekStart: w.weekStart, weekEnd: w.weekEnd,
    score: a.score, amountWei: a.amountWei, poolWei: w.poolWei, balanceWei: w.balanceWei,
    status: a.status, txHash: a.txHash, finalizedAt: w.finalizedAt.toISOString(), mode: ws.mode,
  }));
}
export async function activityFor(ws: CreatorWorkspace, all = false) {
  const rows = await db.select().from(creatorAudit).where(and(eq(creatorAudit.workspaceId, ws.id),
    ws.mode === "demo" || all ? undefined : or(eq(creatorAudit.actor, actorFor(ws)),
      sql`${creatorAudit.details}->>'memberId' = ${String(ws.primaryMemberId)}`)))
    .orderBy(desc(creatorAudit.createdAt)).limit(20);
  return rows.map((r) => ({ id: r.id, message: r.message, createdAt: r.createdAt.toISOString() }));
}
export async function dashboardFor(ws: CreatorWorkspace) {
  const [member, leaderboard, own, activity, weeks] = await Promise.all([
    primaryMember(ws), leaderboardFor(ws), submissionsFor(ws), activityFor(ws),
    db.select().from(creatorWeeks).where(eq(creatorWeeks.workspaceId, ws.id)),
  ]);
  const me = leaderboard.find((r) => r.isYou);
  return { account: accountView(member, ws), weeklyScore: me?.score ?? 0,
    programScore: own.filter((s) => s.status === "approved").reduce((sum, s) => sum + s.score, 0),
    rank: me?.rank ?? 0, approvedCount: me?.contributions ?? 0,
    pendingCount: own.filter((s) => ["submitted", "needs_evidence"].includes(s.status)).length,
    estimatedMonWei: me?.estimatedMonWei ?? (ws.mode === "demo" ? "0" : null),
    samplePoolWei: ws.mode === "demo" ? weeks.find((w) => w.weekStart === weekFor().weekStart)?.poolWei ?? SAMPLE_POOL_WEI.toString() : "0",
    totalWeeklyScore: leaderboard.reduce((sum, s) => sum + s.score, 0), recentSubmissions: own.slice(0, 5),
    activity, finalized: weeks.some((w) => w.weekStart === weekFor().weekStart), ...weekFor(),
  };
}
export async function adminFor(ws: CreatorWorkspace) {
  const [members, submissions, rewards, tasks, audit, weeks] = await Promise.all([
    db.select().from(creatorMemberships).where(eq(creatorMemberships.workspaceId, ws.id)),
    submissionsFor(ws, true), rewardsFor(ws, true), tasksFor(ws), activityFor(ws, true),
    db.select().from(creatorWeeks).where(eq(creatorWeeks.workspaceId, ws.id)),
  ]);
  const treasury = ws.mode === "wallet" ? await getTreasuryBalance() : null;
  return { applications: members.map((m) => accountView(m, ws)), submissions, rewards, tasks, audit,
    finalizedWeeks: weeks.map((w) => w.weekStart), sampleBalanceMon: ws.mode === "demo" ? "1000" : treasury?.balanceWei ? formatEther(BigInt(treasury.balanceWei)) : "", mode: ws.mode };
}
