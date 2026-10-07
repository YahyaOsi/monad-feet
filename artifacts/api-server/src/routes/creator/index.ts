import { Router, type IRouter, type ErrorRequestHandler } from "express";
import { ZodError } from "zod/v4";
import { ZodError as LegacyZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { db, creatorMemberships } from "@workspace/db";
import {
  GetProgramResponse, GetTreasuryResponse, GetAccountResponse, UpdateAccountBody,
  GetDashboardResponse, GetTasksResponse, GetSubmissionsResponse, CreateSubmissionBody,
  CreateSubmissionResponse, UpdateSubmissionBody, UpdateSubmissionParams, UpdateSubmissionResponse,
  ApplyToProgramBody, ApplyToProgramResponse, GetLeaderboardResponse, GetRewardsResponse,
  GetAdminOverviewResponse, ReviewSubmissionBody, ReviewSubmissionParams, ReviewSubmissionResponse,
  ReviewApplicationBody, ReviewApplicationParams, UpdateTaskBody, UpdateTaskParams, UpdateTaskResponse,
  FinalizeWeekBody, FinalizeWeekResponse,
} from "../../lib/creator/contract";
import { program } from "../../lib/creator/config";
import { CreatorError, requireCondition } from "../../lib/creator/errors";
import { accountView, getWorkspace, primaryMember, requireParticipant, requireReviewer, audit, lock, actorFor } from "../../lib/creator/session";
import { getTreasuryBalance } from "../../lib/creator/treasury";
import { activityFor, adminFor, dashboardFor, leaderboardFor, rewardsFor, submissionView, submissionsFor, tasksFor } from "../../lib/creator/queries";
import { saveAccount, submitContribution, amendSubmission, decideSubmission, decideApplication, changeTask, freezeWeek, finalPoints } from "../../lib/creator/mutations";
import authRouter from "./auth";

const router: IRouter = Router();
const limits = new Map<string, { count: number; until: number }>();
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const now = Date.now();
  const key = req.ip ?? "unknown";
  let limit = limits.get(key);
  if (!limit || limit.until < now) {
    limit = { count: 0, until: now + 60000 };
    if (limits.size > 5000) limits.clear();
    limits.set(key, limit);
  }
  limit.count += 1;
  if (limit.count > 240) { res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }
  // Cookie authentication is scoped to this origin. Browser state and arbitrary headers never establish identity.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin) {
      const hosts = new Set([req.get("host")]);
      let permitted = false;
      try { permitted = hosts.has(new URL(origin).host); } catch { /* Reject malformed origins. */ }
      if (!permitted) { res.status(403).json({ error: "Requests must come from this app's origin." }); return; }
    }
    if (req.get("sec-fetch-site") === "cross-site") { res.status(403).json({ error: "Cross site mutations are not allowed." }); return; }
  }
  next();
});
router.use(authRouter);
router.get("/program", (_req, res) => { res.json(GetProgramResponse.parse(program())); });
router.get("/treasury", async (_req, res): Promise<void> => { res.json(GetTreasuryResponse.parse(await getTreasuryBalance())); });
router.get("/account", async (req, res): Promise<void> => {
  const ws = await getWorkspace(req, res, true);
  res.json(GetAccountResponse.parse(accountView(await primaryMember(ws), ws)));
});
router.patch("/account", async (req, res): Promise<void> => {
  const input = UpdateAccountBody.parse(req.body);
  const ws = await getWorkspace(req, res);
  res.json(GetAccountResponse.parse(accountView(await saveAccount(ws, input), ws)));
});
router.post("/application", async (req, res): Promise<void> => {
  const input = ApplyToProgramBody.parse(req.body);
  const ws = await getWorkspace(req, res);
  res.json(ApplyToProgramResponse.parse(accountView(await saveAccount(ws, input, true), ws)));
});
router.get("/dashboard", async (req, res): Promise<void> => { res.json(GetDashboardResponse.parse(await dashboardFor(await getWorkspace(req, res)))); });
router.get("/tasks", async (req, res): Promise<void> => { res.json(GetTasksResponse.parse(await tasksFor(await getWorkspace(req, res)))); });
router.get("/leaderboard", async (req, res): Promise<void> => { res.json(GetLeaderboardResponse.parse(await leaderboardFor(await getWorkspace(req, res)))); });
router.get("/submissions", async (req, res): Promise<void> => { res.json(GetSubmissionsResponse.parse(await submissionsFor(await getWorkspace(req, res)))); });
router.post("/submissions", async (req, res): Promise<void> => {
  const input = CreateSubmissionBody.parse(req.body);
  const result = await submitContribution(await getWorkspace(req, res), input);
  res.status(201).json(CreateSubmissionResponse.parse(submissionView(result.submission, result.name)));
});
router.patch("/submissions/:id", async (req, res): Promise<void> => {
  const { id } = UpdateSubmissionParams.parse(req.params);
  const input = UpdateSubmissionBody.parse(req.body);
  const result = await amendSubmission(await getWorkspace(req, res), id, input);
  res.json(UpdateSubmissionResponse.parse(submissionView(result.submission, result.name)));
});
router.get("/rewards", async (req, res): Promise<void> => { res.json(GetRewardsResponse.parse(await rewardsFor(await getWorkspace(req, res)))); });
router.post("/group", async (req, res): Promise<void> => {
  const ws = await getWorkspace(req, res);
    requireParticipant(ws);
  await db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const member = await primaryMember(ws, tx);
    requireCondition(member.status === "approved" && member.telegramVerified, "An approved application and verified Telegram account are required.", 403);
    if (member.groupStatus !== "requested") {
      await tx.update(creatorMemberships).set({ groupStatus: "requested" }).where(and(eq(creatorMemberships.id, member.id), eq(creatorMemberships.workspaceId, ws.id)));
      await audit(tx, ws.id, "Creator group access requested", { memberId: member.id, status: "Requested only. No invitation issued." }, actorFor(ws));
    }
  });
  res.json({ message: ws.mode === "demo" ? "Preview request recorded. No invitation has been issued." : "Request recorded for controlled manual approval. No invitation has been issued; Telegram automation is not connected." });
});
router.get("/admin", async (req, res): Promise<void> => {
  const ws = await getWorkspace(req, res);
  requireReviewer(ws);
  res.json(GetAdminOverviewResponse.parse(await adminFor(ws)));
});
router.post("/admin/submissions/:id/review", async (req, res): Promise<void> => {
  const { id } = ReviewSubmissionParams.parse(req.params);
  const input = ReviewSubmissionBody.parse(req.body);
  const result = await decideSubmission(await getWorkspace(req, res), id, input);
  res.json(ReviewSubmissionResponse.parse(submissionView(result.submission, result.name)));
});
router.post("/admin/applications/:id/review", async (req, res): Promise<void> => {
  const { id } = ReviewApplicationParams.parse(req.params);
  const input = ReviewApplicationBody.parse(req.body);
  await decideApplication(await getWorkspace(req, res), id, input);
  res.json({ message: "Application decision recorded. Preview decisions never affect main app accounts. Live approvals award the participation badge transactionally." });
});
router.patch("/admin/tasks/:id", async (req, res): Promise<void> => {
  const { id } = UpdateTaskParams.parse(req.params);
  const input = UpdateTaskBody.parse(req.body);
  res.json(UpdateTaskResponse.parse(await changeTask(await getWorkspace(req, res), id, input)));
});
router.post("/admin/finalize", async (req, res): Promise<void> => {
  const input = FinalizeWeekBody.parse(req.body);
  const ws = await getWorkspace(req, res);
  await freezeWeek(ws, input);
  res.json(FinalizeWeekResponse.parse(await rewardsFor(ws, true)));
});
router.post("/admin/points", async (req, res): Promise<void> => {
  const ws = await getWorkspace(req, res);
  await finalPoints(ws);
  res.json({ message: ws.mode === "demo" ? "Exactly 1,000,000 sample points allocated. No main app balance changed." : "Exactly 1,000,000 program points credited atomically to the main app. Repeat credits are blocked." });
});
// Fail closed with friendly errors. Do not leak database details, signatures or private evidence.
const errors: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof CreatorError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof ZodError || error instanceof LegacyZodError) { res.status(400).json({ error: "Check the form fields and try again.", fields: error.issues.map((i) => ({ path: i.path, message: i.message })) }); return; }
  if (error instanceof Error && error.message === "Enter a valid HTTPS link.") { res.status(400).json({ error: error.message }); return; }
  req.log.error({ errorType: error?.name ?? "Error" }, "Creator API request failed");
  res.status(500).json({ error: "The request could not be completed. Please try again." });
};
router.use(errors);
export default router;
