import { and, eq, inArray } from "drizzle-orm";
import { parseEther } from "viem";
import { db, creatorSubmissions, creatorMemberships, creatorTasks, creatorWeeks, creatorAllocations, creatorWorkspaces, type CreatorWorkspace } from "@workspace/db";
import type { AccountInput, ApplicationInput, SubmissionInput, SubmissionUpdate, ReviewInput, ApplicationReview, TaskInput, AllocationInput } from "./contract";
import { audit, lock, primaryMember, requireParticipant, requireReviewer, actorFor } from "./session";
import { requireCondition } from "./errors";
import { apportion, weekFor } from "./config";
import { scoresFor } from "./queries";
import { activityInsideProgram, canFinalizeWeek, canFinalizePoints, launchPolicy } from "./policy";
import { getTreasuryBalance } from "./treasury";
import { awardMainBadge, creditMainPoints, verifyMainPost } from "./main-app";

export function publicUrl(raw: string, optional = false): string {
  if (!raw && optional) return "";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid HTTPS link."); }
  requireCondition(url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443"),
    "Use an HTTPS link without credentials or a custom port.");
  const host = url.hostname.toLowerCase();
  requireCondition(!host.includes(":") && !/^[0-9.]+$/.test(host) && host.includes(".") && host !== "localhost" &&
    !/\.(local|internal|localhost|test)$/.test(host), "Use a public HTTPS link.");
  url.hash = "";
  return url.toString();
}
function contentReference(taskId: string, raw: string) {
  if (taskId === "feet_post" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(raw))
    return { url: raw, key: `feet:${raw}` };
  const url = new URL(publicUrl(raw));
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  if (taskId.startsWith("x_")) {
    requireCondition(["x.com", "twitter.com"].includes(host), "Provide an X post link.");
    const match = path.match(/^\/[a-zA-Z0-9_]+\/status\/([0-9]+)$/);
    requireCondition(match, "Provide a complete X post link including its status ID.");
    return { url: `https://x.com${path}`, key: `x:${match[1]}` };
  }
  if (taskId === "telegram_post") {
    requireCondition(host === "t.me" && /^\/(?:[a-zA-Z0-9_]+\/[0-9]+|c\/[0-9]+\/[0-9]+)$/.test(path), "Provide a Telegram message link.");
    return { url: `https://t.me${path}`, key: `telegram:${path.toLowerCase()}` };
  }
  requireCondition(host === "monadfeet.social", "Provide a Monad Feet post ID or a link on monadfeet.social.");
  return { url: `https://monadfeet.social${path}`, key: `feet:${path}` };
}
async function assertOpen(tx: Parameters<typeof lock>[0], ws: CreatorWorkspace, week: string) {
  const [finalized] = await tx.select().from(creatorWeeks).where(and(eq(creatorWeeks.workspaceId, ws.id), eq(creatorWeeks.weekStart, week)));
  requireCondition(!finalized, "This week is finalized. An explicit adjustment is required; historical scores cannot be changed.", 409);
  const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.id, ws.id));
  requireCondition(!current.pointsFinalized, "Final points have been allocated in this preview. Contributions are closed.", 409);
}
export async function saveAccount(ws: CreatorWorkspace, input: AccountInput | ApplicationInput, application = false) {
  requireParticipant(ws);
  return db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const member = await primaryMember(ws, tx);
    if (application) {
      const policy = launchPolicy();
      requireCondition(ws.mode === "demo" || (Date.now() >= policy.start && Date.now() < policy.end), "Applications are closed outside the approved program dates.", 403);
      requireCondition((input as ApplicationInput).acceptRules, "Accept the program rules before applying.");
      requireCondition(member.status !== "approved", "Your preview membership is already approved. Update your account details instead.", 409);
    }
    const [updated] = await tx.update(creatorMemberships).set({
      name: ws.mode === "demo" ? input.name.trim() : member.name, xHandle: input.xHandle.replace(/^@/, "").trim().toLowerCase(),
      telegramHandle: input.telegramHandle.replace(/^@/, "").trim().toLowerCase(), bio: input.bio, channels: input.channels,
      xVerified: member.xHandle.toLowerCase() === input.xHandle.replace(/^@/, "").trim().toLowerCase() && member.xVerified,
      telegramVerified: member.telegramHandle.toLowerCase() === input.telegramHandle.replace(/^@/, "").trim().toLowerCase() && member.telegramVerified,
      ...(application ? { status: "pending", badge: false } : {}),
    }).where(eq(creatorMemberships.id, member.id)).returning();
    await audit(tx, ws.id, application ? "Application submitted for review" : "Account details updated", { memberId: member.id }, actorFor(ws));
    return updated;
  });
}
export async function submitContribution(ws: CreatorWorkspace, input: SubmissionInput) {
  requireParticipant(ws);
  return db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const member = await primaryMember(ws, tx);
    requireCondition(member.status === "approved", "Your application must be approved before submitting contributions.", 403);
    const [task] = await tx.select().from(creatorTasks).where(and(eq(creatorTasks.workspaceId, ws.id), eq(creatorTasks.id, input.taskId)));
    requireCondition(task && task.enabled, "This task is not available.");
    requireCondition(task.platform !== "X" || member.xVerified, "Your X account needs manual ownership verification before submitting.", 403);
    requireCondition(task.platform !== "Telegram" || member.telegramVerified, "Your Telegram account needs manual ownership verification before submitting.", 403);
    const date = input.activityDate instanceof Date ? input.activityDate.toISOString().slice(0, 10) : String(input.activityDate);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date, "Enter a valid activity date.");
    const week = weekFor(parsedDate);
    requireCondition(ws.mode === "demo" || activityInsideProgram(date), "Live contribution dates must fall within the approved active program.");
    requireCondition(week.weekStart === weekFor().weekStart && date <= new Date().toISOString().slice(0, 10), "Submit an activity from the current UTC week, not a future date.");
    await assertOpen(tx, ws, week.weekStart);
    const ref = ws.mode === "wallet" && task.id === "feet_post" ?
      await verifyMainPost(tx, member.mainUserId!, input.contentUrl.trim(), date) : contentReference(task.id, input.contentUrl.trim());
    if (task.id === "x_original") {
      const author = new URL(ref.url).pathname.split("/")[1];
      requireCondition(author.toLowerCase() === member.xHandle.toLowerCase(), "The X post author must match your verified account.");
    }
    const evidenceUrl = publicUrl(input.evidenceUrl.trim(), true);
    const previous = await tx.select().from(creatorSubmissions).where(and(eq(creatorSubmissions.workspaceId, ws.id), eq(creatorSubmissions.taskId, task.id)));
    requireCondition(!previous.some((s) => s.contentKey === ref.key), "This activity has already been submitted. Update its evidence or appeal instead.", 409);
    const daily = previous.filter((s) => s.memberId === member.id && s.activityDate === date && !["withdrawn", "rejected"].includes(s.status));
    requireCondition(daily.length < task.dailyLimit, "You have reached this task's daily submission limit.", 409);
    const [submission] = await tx.insert(creatorSubmissions).values({
      workspaceId: ws.id, memberId: member.id, taskId: task.id, taskTitle: task.title, platform: task.platform,
      contentUrl: ref.url, contentKey: ref.key, description: input.description, evidenceUrl,
      activityDate: date, weekStart: week.weekStart, proposedScore: task.score, ruleVersion: task.version, weeklyCap: task.weeklyCap, dailyLimit: task.dailyLimit,
    }).returning();
    await audit(tx, ws.id, `New contribution submitted: ${task.title}`, { submissionId: submission.id, ruleVersion: task.version }, actorFor(ws));
    return { submission, name: member.name };
  });
}
export async function amendSubmission(ws: CreatorWorkspace, id: number, input: SubmissionUpdate) {
  requireParticipant(ws);
  return db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const [old] = await tx.select().from(creatorSubmissions).where(and(eq(creatorSubmissions.id, id), eq(creatorSubmissions.workspaceId, ws.id), eq(creatorSubmissions.memberId, ws.primaryMemberId!)));
    requireCondition(old, "Submission not found.", 404);
    await assertOpen(tx, ws, old.weekStart);
    requireCondition(ws.mode === "demo" || !canFinalizeWeek(old.weekStart), "The approved evidence and appeal deadline has passed.", 409);
    let changes: Partial<typeof creatorSubmissions.$inferInsert>;
    if (input.action === "withdraw") {
      requireCondition(["submitted", "needs_evidence"].includes(old.status), "Only unapproved submissions can be withdrawn.");
      changes = { status: "withdrawn", score: 0 };
    } else if (input.action === "appeal") {
      requireCondition(old.status === "rejected" && !old.appealNote, "Only a rejected submission can be appealed once.");
      requireCondition(input.note && input.note.trim().length >= 10, "Explain your appeal in at least 10 characters.");
      changes = { status: "submitted", appealNote: input.note, score: 0 };
    } else {
      requireCondition(["submitted", "needs_evidence"].includes(old.status), "Only pending submissions can receive new evidence.");
      const evidenceUrl = publicUrl(input.evidenceUrl ?? "", true);
      requireCondition(evidenceUrl || (input.note?.trim().length ?? 0) >= 10, "Add an evidence link or a useful explanation.");
      changes = { evidenceUrl, description: input.note ?? old.description, status: "submitted", score: 0 };
    }
    const [submission] = await tx.update(creatorSubmissions).set(changes).where(eq(creatorSubmissions.id, id)).returning();
    await audit(tx, ws.id, `Submission ${input.action === "evidence" ? "evidence updated" : input.action === "appeal" ? "appealed" : "withdrawn"}`, { submissionId: id, before: old.status, after: submission.status }, actorFor(ws));
    return { submission, name: (await primaryMember(ws, tx)).name };
  });
}
export async function decideSubmission(ws: CreatorWorkspace, id: number, input: ReviewInput) {
  requireReviewer(ws);
  requireParticipant(ws);
  return db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const [old] = await tx.select().from(creatorSubmissions).where(and(eq(creatorSubmissions.id, id), eq(creatorSubmissions.workspaceId, ws.id)));
    requireCondition(old, "Submission not found.", 404);
    await assertOpen(tx, ws, old.weekStart);
    requireCondition(["submitted", "needs_evidence"].includes(old.status), "This submission has already received a final decision.", 409);
    const [member] = await tx.select().from(creatorMemberships).where(eq(creatorMemberships.id, old.memberId));
    requireCondition(member.status === "approved", "Only approved memberships can receive scores.", 403);
    let score = 0;
    if (input.decision === "approved") {
      requireCondition(old.platform !== "X" || member.xVerified, "Verify the participant's X account before approving.");
      requireCondition(old.platform !== "Telegram" || member.telegramVerified, "Verify the participant's Telegram account before approving.");
      if (ws.mode === "wallet" && old.taskId === "feet_post") await verifyMainPost(tx, member.mainUserId!, old.contentUrl, old.activityDate);
      const peers = await tx.select().from(creatorSubmissions).where(and(eq(creatorSubmissions.workspaceId, ws.id), eq(creatorSubmissions.memberId, member.id),
        eq(creatorSubmissions.status, "approved"), eq(creatorSubmissions.weekStart, old.weekStart)));
      requireCondition(peers.filter((p) => p.taskId === old.taskId && p.activityDate === old.activityDate).length < old.dailyLimit,
        "A qualifying contribution for this task and date was already approved.", 409);
      score = old.proposedScore;
      // Like and repost scores share one engagement cap, rather than each consuming an independent cap.
      if (old.taskId === "x_like" || old.taskId === "x_repost") {
        const used = peers.filter((p) => ["x_like", "x_repost"].includes(p.taskId)).reduce((sum, p) => sum + p.score, 0);
        score = Math.max(0, Math.min(score, old.weeklyCap - used));
      } else if (old.weeklyCap > 0) {
        const used = peers.filter((p) => p.taskId === old.taskId).reduce((sum, p) => sum + p.score, 0);
        score = Math.max(0, Math.min(score, old.weeklyCap - used));
      }
    }
    const [submission] = await tx.update(creatorSubmissions).set({ status: input.decision, score, reviewNote: input.note, reviewedAt: new Date() })
      .where(eq(creatorSubmissions.id, id)).returning();
    await audit(tx, ws.id, `Contribution ${input.decision.replace("_", " ")}: ${member.name}`, {
      submissionId: id, reviewer: actorFor(ws), before: old.status, decision: input.decision, score, ruleVersion: old.ruleVersion, note: input.note,
    }, actorFor(ws));
    return { submission, name: member.name };
  });
}
export async function decideApplication(ws: CreatorWorkspace, id: number, input: ApplicationReview) {
  requireReviewer(ws);
  requireParticipant(ws);
  await db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const [member] = await tx.select().from(creatorMemberships).where(and(eq(creatorMemberships.workspaceId, ws.id), eq(creatorMemberships.id, id)));
    requireCondition(member, "Application not found.", 404);
    // Approved preview profiles can have socials manually verified without revoking an existing membership.
    requireCondition(member.status === "pending" || member.status === "approved", "This application is not awaiting review.");
    requireCondition(!(member.status === "approved" && input.decision === "rejected"), "Existing memberships cannot be removed through application review.");
    if (input.decision === "approved") {
      const peers = await tx.select().from(creatorMemberships).where(eq(creatorMemberships.workspaceId, ws.id));
      requireCondition(!input.verifyX || !peers.some((p) => p.id !== id && p.xVerified && p.xHandle.toLowerCase() === member.xHandle.toLowerCase()), "This X account is already verified for another participant.", 409);
      requireCondition(!input.verifyTelegram || !peers.some((p) => p.id !== id && p.telegramVerified && p.telegramHandle.toLowerCase() === member.telegramHandle.toLowerCase()), "This Telegram account is already verified for another participant.", 409);
      if (ws.mode === "wallet") await awardMainBadge(tx, member.mainUserId!);
    }
    await tx.update(creatorMemberships).set({ status: input.decision, badge: input.decision === "approved",
      xVerified: input.decision === "approved" && input.verifyX && !!member.xHandle,
      telegramVerified: input.decision === "approved" && input.verifyTelegram && !!member.telegramHandle,
      reviewNote: input.note,
    }).where(eq(creatorMemberships.id, id));
    await audit(tx, ws.id, `Application ${input.decision}: ${member.name}`, { memberId: id, decision: input.decision, note: input.note, verifyX: input.verifyX, verifyTelegram: input.verifyTelegram, badgeSync: ws.mode === "demo" ? "Preview only" : "Main app" }, actorFor(ws));
  });
}
export async function changeTask(ws: CreatorWorkspace, id: string, input: TaskInput) {
  requireReviewer(ws);
  return db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const [old] = await tx.select().from(creatorTasks).where(and(eq(creatorTasks.workspaceId, ws.id), eq(creatorTasks.id, id)));
    requireCondition(old, "Task not found.", 404);
    const campaignUrl = publicUrl(input.campaignUrl, true);
    const [task] = await tx.update(creatorTasks).set({ ...input, campaignUrl, version: old.version + 1 }).where(eq(creatorTasks.rowId, old.rowId)).returning();
    await audit(tx, ws.id, `Scoring rule updated: ${task.title}`, { taskId: id, oldRule: old, newRule: task }, actorFor(ws));
    return task;
  });
}
export async function freezeWeek(ws: CreatorWorkspace, input: AllocationInput) {
  requireReviewer(ws);
  requireParticipant(ws);
  requireCondition(input.confirm, "Confirm that the balance snapshot and score list have been reviewed.");
  const weekStart = input.weekStart instanceof Date ? input.weekStart.toISOString().slice(0, 10) : String(input.weekStart);
  requireCondition(ws.mode === "demo" ? weekStart === weekFor().weekStart : canFinalizeWeek(weekStart), "Finalize a completed program week only after its published review and appeal deadline.");
  const balance = parseEther(input.balanceMon);
  const liveSnapshot = ws.mode === "wallet" ? await getTreasuryBalance(true) : null;
  if (liveSnapshot) requireCondition(liveSnapshot.status === "live" && liveSnapshot.balanceWei === balance.toString(),
    "The live treasury snapshot is unavailable or has changed. Review the current balance and confirm again.", 409);
  requireCondition(balance <= 10n ** 30n, "Sample balance is too large.");
  await db.transaction(async (tx) => {
    await lock(tx, ws.id);
    await assertOpen(tx, ws, weekStart);
    const pending = await tx.select().from(creatorSubmissions).where(and(eq(creatorSubmissions.workspaceId, ws.id), eq(creatorSubmissions.weekStart, weekStart), inArray(creatorSubmissions.status, ["submitted", "needs_evidence"])));
    requireCondition(pending.length === 0, "Finish all submitted and evidence pending reviews before finalizing.", 409);
    const scores = (await scoresFor(ws, weekStart, tx)).filter((s) => s.score > 0);
    const pool = balance * 55n / 100n;
    if (ws.mode === "wallet") {
      const outstanding = await tx.select().from(creatorAllocations).where(eq(creatorAllocations.workspaceId, ws.id));
      const reserved = outstanding.filter((a) => !a.txHash).reduce((sum, a) => sum + BigInt(a.amountWei), 0n);
      requireCondition(reserved + pool <= balance, "Existing unpaid allocations and this pool exceed the treasury balance. Reconcile approved payments before reserving another week.", 409);
    }
    const parts = apportion(pool, scores);
    const [week] = await tx.insert(creatorWeeks).values({
      workspaceId: ws.id, weekStart, weekEnd: weekFor(new Date(`${weekStart}T00:00:00Z`)).weekEnd,
      balanceWei: balance.toString(), poolWei: pool.toString(), status: scores.length ? "finalized" : "carry_forward",
      snapshot: { mode: ws.mode, basis: ws.mode === "demo" ? "55 percent of sample treasury balance" : "55 percent of treasury MON balance",
        chainId: 143, treasury: liveSnapshot?.wallet, blockNumber: liveSnapshot?.blockNumber, fetchedAt: liveSnapshot?.fetchedAt,
        rounding: "largest remainder, stable member ID",
        scores: scores.map((s) => ({ id: s.id, name: s.member.name, wallet: s.member.wallet, score: s.score })) },
    }).returning();
    if (parts.length) await tx.insert(creatorAllocations).values(parts.map((part) => {
      const score = scores.find((s) => s.id === part.id)!;
      return { workspaceId: ws.id, weekId: week.id, memberId: score.id, creatorName: score.member.name,
        recipientWallet: score.member.wallet, score: score.score, amountWei: part.amount.toString() };
    }));
    await audit(tx, ws.id, scores.length ? "Weekly allocations finalized" : "Zero score pool reserved for carry forward", { weekId: week.id, poolWei: pool.toString(), paymentsSent: false }, actorFor(ws));
  });
}
export async function finalPoints(ws: CreatorWorkspace) {
  requireReviewer(ws);
  requireParticipant(ws);
  requireCondition(ws.mode === "demo" || canFinalizePoints(), "Final points can be credited only after the approved program and review window end.");
  await db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.id, ws.id));
    requireCondition(!current.pointsFinalized, "Final points have already been allocated. No duplicate allocation was created.", 409);
    if (ws.mode === "wallet") {
      const weeks = await tx.select().from(creatorWeeks).where(eq(creatorWeeks.workspaceId, ws.id));
      const policy = launchPolicy();
      for (let start = policy.start; start < policy.end; start += 7 * 86400000)
        requireCondition(weeks.some((w) => w.weekStart === new Date(start).toISOString().slice(0, 10)), "Finalize every program week before crediting final points.", 409);
    }
    const pending = await tx.select().from(creatorSubmissions).where(and(eq(creatorSubmissions.workspaceId, ws.id), inArray(creatorSubmissions.status, ["submitted", "needs_evidence"])));
    requireCondition(pending.length === 0, "Finish all contribution reviews before allocating final points.", 409);
    const scores = (await scoresFor(ws, undefined, tx)).filter((s) => s.score > 0);
    requireCondition(scores.length > 0, "No eligible scores. The points pool remains unallocated.", 409);
    const parts = apportion(1_000_000n, scores);
    for (const part of parts) {
      if (ws.mode === "wallet") await creditMainPoints(tx, ws, part.id, Number(part.amount));
      await tx.update(creatorMemberships).set({ pointsAllocated: Number(part.amount) }).where(eq(creatorMemberships.id, part.id));
    }
    await tx.update(creatorWorkspaces).set({ pointsFinalized: true }).where(eq(creatorWorkspaces.id, ws.id));
    await audit(tx, ws.id, "Final points allocation recorded", { allocations: parts.map((p) => ({ id: p.id, points: p.amount.toString() })), creditedToMainApp: ws.mode === "wallet" }, actorFor(ws));
  });
}
