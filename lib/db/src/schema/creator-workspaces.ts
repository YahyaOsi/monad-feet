import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const creatorWorkspaces = pgTable("creator_workspaces", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  programKey: text("program_key").unique(),
  sessionHash: text("session_hash").notNull().unique(),
  wallet: text("wallet"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  primaryMemberId: integer("primary_member_id"),
  pointsFinalized: boolean("points_finalized").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertWorkspaceSchema = createInsertSchema(creatorWorkspaces).omit({ id: true, createdAt: true });
export type CreatorWorkspace = typeof creatorWorkspaces.$inferSelect;
