import { db, subscriptionQuotesTable, subscriptionPaymentsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Must run inside the same transaction that grants/renews access. */
export async function claimSubscriptionQuote(
  tx: Transaction, quote: typeof subscriptionQuotesTable.$inferSelect, hash: string,
) {
  await tx.select().from(usersTable).where(eq(usersTable.id, quote.subscriberId)).for("update");
  const [locked] = await tx.select().from(subscriptionQuotesTable)
    .where(eq(subscriptionQuotesTable.id, quote.id)).for("update");
  if (!locked || locked.subscriberId !== quote.subscriberId || locked.creatorId !== quote.creatorId) {
    throw new Error("Quote identity mismatch");
  }
  if (locked.consumedHash) throw Object.assign(new Error("Quote consumed"), { code: "23505" });
  await tx.update(subscriptionQuotesTable).set({ consumedHash: hash.toLowerCase() })
    .where(eq(subscriptionQuotesTable.id, quote.id));
  await tx.insert(subscriptionPaymentsTable).values({
    txHash: hash.toLowerCase(), subscriberId: quote.subscriberId, creatorId: quote.creatorId,
  });
}