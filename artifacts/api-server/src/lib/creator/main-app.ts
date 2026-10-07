import { and, eq, sql } from "drizzle-orm";
import { badgesTable, creatorMemberships, postsTable, rewardClaimsTable, streaksTable } from "@workspace/db";
import type { CreatorWorkspace } from "@workspace/db";
import { requireCondition } from "./errors";
import type { Transaction } from "./session";

export async function verifyMainPost(tx: Transaction, userId: number, reference: string, date: string) {
  let id = reference;
  if (reference.startsWith("https://")) {
    const url = new URL(reference);
    requireCondition(url.hostname === "monadfeet.social" && !url.username && !url.password && (!url.port || url.port === "443"), "Provide a direct Monad Feet post link or its numeric ID.");
    const match = url.pathname.match(/^\/(?:post|posts)\/([1-9][0-9]*)$/);
    requireCondition(match, "Provide the main app post ID or a direct post link.");
    id = match[1];
  }
  requireCondition(/^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647, "Provide a numeric Monad Feet post ID.");
  const [post] = await tx.select().from(postsTable).where(eq(postsTable.id, Number(id)));
  requireCondition(post && post.authorId === userId && !post.isPaid, "Only your own public Monad Feet posts can qualify.", 403);
  requireCondition(post.createdAt.toISOString().slice(0, 10) === date, "The activity date must match the post's original UTC publication date.");
  return { url: `https://monadfeet.social/post/${post.id}`, key: `feet:${post.id}` };
}

export async function awardMainBadge(tx: Transaction, userId: number) {
  const [existing] = await tx.select({ id: badgesTable.id }).from(badgesTable).where(and(
    eq(badgesTable.userId, userId), eq(badgesTable.badgeType, "creator_program"),
  ));
  if (!existing) await tx.insert(badgesTable).values({
    userId, badgeType: "creator_program", label: "Creator Program",
    description: "Participates in the Monad Feet Creator Program. This is not identity verification.",
  });
}

export async function creditMainPoints(tx: Transaction, ws: CreatorWorkspace, memberId: number, amount: number) {
  const [member] = await tx.select().from(creatorMemberships).where(and(
    eq(creatorMemberships.id, memberId), eq(creatorMemberships.workspaceId, ws.id),
  ));
  requireCondition(member?.mainUserId && member.status === "approved", "A verified main app membership is required for points.");
  const [claim] = await tx.insert(rewardClaimsTable).values({
    userId: member.mainUserId, task: `creator_program:${ws.programKey}`, dayKey: "once", points: amount, invites: 0,
  }).onConflictDoNothing().returning({ id: rewardClaimsTable.id });
  requireCondition(claim, "This user's program points were already credited. No duplicate allocation was made.", 409);
  await tx.insert(streaksTable).values({ userId: member.mainUserId }).onConflictDoNothing();
  // Add to the existing authoritative balance. Never replace or rescale it.
  await tx.update(streaksTable).set({ totalPoints: sql`${streaksTable.totalPoints} + ${amount}` })
    .where(eq(streaksTable.userId, member.mainUserId));
}
