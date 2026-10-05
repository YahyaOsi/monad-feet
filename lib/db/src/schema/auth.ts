import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const walletChallengesTable = pgTable("wallet_challenges", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  origin: text("origin").notNull(),
  message: text("message").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const walletSessionsTable = pgTable("wallet_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});