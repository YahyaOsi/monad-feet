import { pgTable, serial, text, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { creatorWorkspaces } from "./creator-workspaces";

export const creatorTasks = pgTable("creator_tasks", {
  rowId: serial("row_id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => creatorWorkspaces.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  platform: text("platform").notNull(),
  score: integer("score").notNull(),
  dailyLimit: integer("daily_limit").notNull().default(1),
  weeklyCap: integer("weekly_cap").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  campaignTitle: text("campaign_title").notNull(),
  campaignUrl: text("campaign_url").notNull(),
  evidenceHint: text("evidence_hint").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => [uniqueIndex("creator_task_scope").on(t.workspaceId, t.id)]);
export const insertTaskSchema = createInsertSchema(creatorTasks).omit({ rowId: true });
export type CreatorTask = typeof creatorTasks.$inferSelect;
