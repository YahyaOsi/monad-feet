import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// This table is written only after the server has independently checked the
// Monad registration receipt. Legacy client-supplied hashes do NOT grant access.
export const verifiedRegistrationsTable = pgTable("verified_registrations", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id),
  txHash: text("tx_hash").notNull().unique(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});