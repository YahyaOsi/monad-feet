import { pgTable, text, integer, timestamp, primaryKey, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/** Immutable receipt ledger shared by game and check-in claims. Never erase on renewal. */
export const chainRewardClaimsTable = pgTable("chain_reward_claims", {
  contractAddress: text("contract_address").notNull(),
  txHash: text("tx_hash").notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  kind: text("kind").notNull(),
  actionType: integer("action_type"),
  pointsAwarded: integer("points_awarded").notNull(),
  inviteCodes: jsonb("invite_codes").$type<string[]>().notNull().default([]),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.contractAddress, t.txHash] })]);

export const insertChainRewardClaimSchema = createInsertSchema(chainRewardClaimsTable).omit({ createdAt: true });
export type InsertChainRewardClaim = z.infer<typeof insertChainRewardClaimSchema>;
export type ChainRewardClaim = typeof chainRewardClaimsTable.$inferSelect;