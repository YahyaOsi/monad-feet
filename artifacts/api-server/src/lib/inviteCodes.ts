import { and, eq, isNull } from "drizzle-orm";
import { db, inviteCodesTable } from "@workspace/db";

type InviteStatus = { usedById: number | null; usedAt: Date | null };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function isInviteUsed(invite: InviteStatus): boolean {
  return invite.usedById !== null || invite.usedAt !== null;
}

// Claim inside the signup transaction. The conditional update is atomic even
// across server instances. A failed signup rolls the claim back with the account.
export async function consumeInviteCode(tx: Transaction, inviteId: number, userId: number): Promise<boolean> {
  const claimed = await tx.update(inviteCodesTable)
    .set({ usedById: userId, usedAt: new Date() })
    .where(and(
      eq(inviteCodesTable.id, inviteId),
      isNull(inviteCodesTable.usedById),
      isNull(inviteCodesTable.usedAt),
    ))
    .returning({ id: inviteCodesTable.id });
  return claimed.length === 1;
}