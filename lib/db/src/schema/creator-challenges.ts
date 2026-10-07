import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { creatorWorkspaces } from "./creator-workspaces";

export const creatorChallenges = pgTable("creator_wallet_challenges", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => creatorWorkspaces.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull(),
  wallet: text("wallet").notNull(),
  message: text("message").notNull(),
  origin: text("origin").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});
export const insertChallengeSchema = createInsertSchema(creatorChallenges);
