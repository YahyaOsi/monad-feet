import { pgTable, serial, text, integer, timestamp, date, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { creatorWorkspaces } from "./creator-workspaces";
import { creatorMemberships } from "./creator-memberships";

export const creatorWeeks = pgTable("creator_weeks", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => creatorWorkspaces.id, { onDelete: "cascade" }),
  weekStart: date("week_start", { mode: "string" }).notNull(),
  weekEnd: date("week_end", { mode: "string" }).notNull(),
  balanceWei: text("balance_wei").notNull(),
  poolWei: text("pool_wei").notNull(),
  status: text("status").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("creator_week_scope").on(t.workspaceId, t.weekStart)]);
export const creatorAllocations = pgTable("creator_allocations", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => creatorWorkspaces.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => creatorMemberships.id),
  weekId: integer("week_id").notNull().references(() => creatorWeeks.id),
  creatorName: text("creator_name").notNull(),
  recipientWallet: text("recipient_wallet"),
  score: integer("score").notNull(),
  amountWei: text("amount_wei").notNull(),
  status: text("status").notNull().default("final_allocation"),
  txHash: text("tx_hash").unique(),
}, (t) => [uniqueIndex("creator_allocation_unique").on(t.weekId, t.memberId)]);
export const insertWeekSchema = createInsertSchema(creatorWeeks).omit({ id: true, finalizedAt: true });
export const insertAllocationSchema = createInsertSchema(creatorAllocations).omit({ id: true });
