import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, creatorWorkspaces, creatorMemberships, creatorTasks, creatorSubmissions, creatorAudit, creatorSessions, usersTable, badgesTable, type CreatorWorkspace } from "@workspace/db";
import { initialTasks, weekFor } from "./config";
import { CreatorError, requireCondition } from "./errors";
import { hasVerifiedRegistration } from "../walletAuth";
import { LIVE_PROGRAM_KEY, isCreatorAdmin, launchPolicy } from "./policy";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const COOKIE = "mf_creator_session";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const actorFor = (ws: CreatorWorkspace) => ws.mode === "demo" ? "Preview reviewer" : `Authenticated creator member ${ws.primaryMemberId}`;
export const randomCode = () => randomBytes(16).toString("hex");

export async function lock(tx: Transaction, workspaceId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7423, ${workspaceId})`);
}
export async function audit(tx: Transaction, workspaceId: number, message: string, details: unknown = {}, actor = "Preview reviewer") {
  await tx.insert(creatorAudit).values({ workspaceId, message, details, actor });
}
export function setSession(req: Request, res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" || req.secure || req.get("x-forwarded-proto") === "https",
    maxAge: 7 * 24 * 60 * 60 * 1000, path: "/api/creator",
  });
}
export function clearSession(res: Response) { res.clearCookie(COOKIE, { path: "/api/creator" }); }

export async function newWorkspace(req: Request, res: Response, mode: "demo" | "wallet" = "demo", wallet?: string, asApplicant = false) {
  if (mode === "wallet") return newLiveWorkspace(req, res, wallet!);
  const token = randomCode();
  const workspace = await db.transaction(async (tx) => {
    const [ws] = await tx.insert(creatorWorkspaces).values({
      mode, wallet: wallet ?? null, sessionHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000),
    }).returning();
    const [me] = await tx.insert(creatorMemberships).values({
      workspaceId: ws.id, name: mode === "demo" ? "Alex Morgan" : "Connected wallet",
      handle: mode === "demo" ? "alexcreates" : "", wallet: wallet ?? null,
      status: mode === "demo" ? asApplicant ? "not_applied" : "approved" : "integration_required",
      badge: mode === "demo" && !asApplicant, xHandle: mode === "demo" ? "alexcreates" : "",
      telegramHandle: mode === "demo" ? "alexcreates" : "", xVerified: mode === "demo" && !asApplicant,
      telegramVerified: mode === "demo" && !asApplicant, verificationCode: `MF${randomBytes(5).toString("hex").toUpperCase()}`,
      bio: mode === "demo" ? "I share useful guides and stories with the Monad community." : "",
      channels: mode === "demo" ? "My own community channel. Sample membership only." : "",
    }).returning();
    await tx.update(creatorWorkspaces).set({ primaryMemberId: me.id }).where(eq(creatorWorkspaces.id, ws.id));
    await tx.insert(creatorSessions).values({ tokenHash: hash(token), workspaceId: ws.id, memberId: me.id, expiresAt: ws.expiresAt });
    await tx.insert(creatorTasks).values(initialTasks.map((t) => ({ ...t, workspaceId: ws.id })));
    if (mode === "demo") {
      const others = await tx.insert(creatorMemberships).values([
        { workspaceId: ws.id, name: "Mia Chen", handle: "miainmonad", status: "approved", badge: true, xHandle: "miainmonad", xVerified: true, telegramHandle: "miainmonad", telegramVerified: true, verificationCode: `MF${randomCode().slice(0, 10)}`, bio: "Community guides and everyday Monad stories.", channels: "My community group" },
        { workspaceId: ws.id, name: "Jordan Lee", handle: "jordanonchain", status: "pending", xHandle: "jordanonchain", telegramHandle: "jordanonchain", verificationCode: `MF${randomCode().slice(0, 10)}`, bio: "I want to create original guides that introduce Monad Feet to new users.", channels: "My own channel" },
      ]).returning();
      const today = new Date().toISOString().slice(0, 10);
      const week = weekFor();
      const examples = [
        { memberId: me.id, task: initialTasks[0], status: "approved", contentUrl: "https://x.com/alexcreates/status/100000001", description: "Sample guide: getting started with Monad Feet." },
        { memberId: me.id, task: initialTasks[1], status: "approved", contentUrl: "https://t.me/alexcreates/101", description: "Sample community introduction and discussion." },
        { memberId: me.id, task: initialTasks[2], status: "approved", contentUrl: "previewpost101", description: "Sample daily photo story. Internal verification is simulated." },
        { memberId: me.id, task: initialTasks[0], status: "submitted", contentUrl: "https://x.com/alexcreates/status/100000002", description: "Sample contribution waiting for a reviewer." },
        { memberId: me.id, task: initialTasks[1], status: "needs_evidence", contentUrl: "https://t.me/alexcreates/102", description: "Sample message in a private group." },
        { memberId: others[0].id, task: initialTasks[0], status: "approved", contentUrl: "https://x.com/miainmonad/status/100000003", description: "Sample creator introduction." },
        { memberId: others[0].id, task: initialTasks[1], status: "approved", contentUrl: "https://t.me/miainmonad/103", description: "Sample helpful community post." },
      ];
      await tx.insert(creatorSubmissions).values(examples.filter((e) => !asApplicant || e.memberId !== me.id).map((e) => ({
        workspaceId: ws.id, memberId: e.memberId, taskId: e.task.id, taskTitle: e.task.title,
        platform: e.task.platform, contentUrl: e.contentUrl, contentKey: e.contentUrl,
        description: e.description,
        activityDate: e.status === "approved" ? new Date(Date.now() - 86400000).toISOString().slice(0, 10) : today,
        weekStart: e.status === "approved" ? weekFor(new Date(Date.now() - 86400000)).weekStart : week.weekStart,
        status: e.status,
        score: e.status === "approved" ? e.task.score : 0, proposedScore: e.task.score,
        ruleVersion: 1, weeklyCap: e.task.weeklyCap,
        reviewNote: e.status === "approved" ? "Sample approval. No real activity was verified." : e.status === "needs_evidence" ? "Please add a supporting link showing your message and permission to post." : "",
        reviewedAt: e.status === "approved" ? new Date() : null,
      })));
      await audit(tx, ws.id, "Preview workspace created", { mode: "demo", realRewards: false }, "System");
    }
    return { ...ws, primaryMemberId: me.id };
  });
  setSession(req, res, token);
  res.locals.creatorSessionHash = hash(token);
  res.locals.creatorWorkspace = workspace;
  return workspace;
}

export async function getWorkspace(req: Request, res: Response, create = false): Promise<CreatorWorkspace> {
  if (res.locals.creatorWorkspace) return res.locals.creatorWorkspace as CreatorWorkspace;
  const token: unknown = req.cookies?.[COOKIE];
  if (typeof token === "string" && /^[a-f0-9]{32}$/.test(token)) {
    const [session] = await db.select({ workspace: creatorWorkspaces, memberId: creatorSessions.memberId })
      .from(creatorSessions).innerJoin(creatorWorkspaces, eq(creatorWorkspaces.id, creatorSessions.workspaceId))
      .where(and(eq(creatorSessions.tokenHash, hash(token)), gt(creatorSessions.expiresAt, new Date())));
    if (session) {
      const workspace = { ...session.workspace, primaryMemberId: session.memberId };
      if (workspace.mode === "wallet") {
        const [member] = await db.select().from(creatorMemberships).where(and(eq(creatorMemberships.id, session.memberId), eq(creatorMemberships.workspaceId, workspace.id)));
        requireCondition(member?.mainUserId, "Main app account link is missing.", 403);
        const user = await verifiedUser(member.wallet!);
        requireCondition(user.id === member.mainUserId, "Main app account link does not match this session.", 403);
        workspace.wallet = user.walletAddress;
      }
      res.locals.creatorSessionHash = hash(token);
      res.locals.creatorWorkspace = workspace;
      return workspace;
    }
  }
  if (create) return newWorkspace(req, res);
  throw new CreatorError(401, "Open your account to start a preview session.");
}
export function requirePreview(ws: CreatorWorkspace) {
  requireCondition(ws.mode === "demo", "This action is available only in an isolated preview.", 403);
}
export function requireParticipant(ws: CreatorWorkspace) {
  if (ws.mode !== "demo") requireCondition(launchPolicy().ready, "The program owner must approve dates, deadlines and rules before live participation opens.", 503);
}
export function requireReviewer(ws: CreatorWorkspace) {
  requireCondition(ws.mode === "demo" || isCreatorAdmin(ws.wallet), "Creator program administrator permission is required.", 403);
}
export async function endSession(res: Response) {
  const sessionHash = res.locals.creatorSessionHash as string | undefined;
  if (sessionHash) await db.delete(creatorSessions).where(eq(creatorSessions.tokenHash, sessionHash));
  clearSession(res);
}
async function verifiedUser(wallet: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet.toLowerCase()));
  requireCondition(user && await hasVerifiedRegistration(user), "Complete normal Monad Feet registration before joining the creator program. Wallet ownership alone is not membership.", 403);
  return user;
}
async function newLiveWorkspace(req: Request, res: Response, wallet: string): Promise<CreatorWorkspace> {
  const user = await verifiedUser(wallet);
  const token = randomCode();
  const result = await db.transaction(async (tx) => {
    await lock(tx, -1);
    let [workspace] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.programKey, LIVE_PROGRAM_KEY));
    if (!workspace) {
      [workspace] = await tx.insert(creatorWorkspaces).values({
        mode: "wallet", programKey: LIVE_PROGRAM_KEY, sessionHash: hash(randomCode()),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      }).returning();
      await tx.insert(creatorTasks).values(initialTasks.map((t) => ({ ...t, workspaceId: workspace.id })));
    }
    let [member] = await tx.select().from(creatorMemberships).where(and(
      eq(creatorMemberships.workspaceId, workspace.id), eq(creatorMemberships.mainUserId, user.id),
    ));
    if (!member) [member] = await tx.insert(creatorMemberships).values({
      workspaceId: workspace.id, mainUserId: user.id, wallet: user.walletAddress,
      name: user.name ?? user.username ?? "Monad Feet member", handle: user.username ?? "",
      status: "not_applied", verificationCode: `MF${randomBytes(5).toString("hex").toUpperCase()}`,
      bio: user.bio ?? "",
    }).returning();
    await tx.insert(creatorSessions).values({
      tokenHash: hash(token), workspaceId: workspace.id, memberId: member.id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    return { ...workspace, wallet: user.walletAddress, primaryMemberId: member.id };
  });
  setSession(req, res, token);
  res.locals.creatorSessionHash = hash(token);
  res.locals.creatorWorkspace = result;
  return result;
}
export async function primaryMember(ws: CreatorWorkspace, tx: Transaction | typeof db = db) {
  const [member] = await tx.select().from(creatorMemberships).where(and(eq(creatorMemberships.workspaceId, ws.id), eq(creatorMemberships.id, ws.primaryMemberId!)));
  requireCondition(member, "Account not found.", 404);
  if (ws.mode === "wallet") {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, member.mainUserId!));
    requireCondition(user, "Main app account no longer exists.", 403);
    const [badge] = await tx.select({ id: badgesTable.id }).from(badgesTable).where(and(
      eq(badgesTable.userId, user.id), eq(badgesTable.badgeType, "creator_program"),
    ));
    return { ...member, name: user.name ?? user.username ?? "Monad Feet member", handle: user.username ?? "",
      wallet: user.walletAddress, badge: !!badge };
  }
  return member;
}
export function accountView(member: typeof creatorMemberships.$inferSelect, ws: CreatorWorkspace) {
  return {
    id: member.id, mode: ws.mode as "demo" | "wallet", name: member.name, handle: member.handle,
    wallet: member.wallet, mainUserId: member.mainUserId === null ? null : String(member.mainUserId), membershipStatus: member.status,
    badge: member.badge, xHandle: member.xHandle, telegramHandle: member.telegramHandle,
    xVerified: member.xVerified, telegramVerified: member.telegramVerified,
    verificationCode: member.verificationCode, groupStatus: member.groupStatus, bio: member.bio,
    channels: member.channels, canReview: ws.mode === "demo" || (member.id === ws.primaryMemberId && isCreatorAdmin(ws.wallet)), pointsAllocated: member.pointsAllocated,
  };
}
