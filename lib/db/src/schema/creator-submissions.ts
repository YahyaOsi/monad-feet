import { pgTable, serial, text, integer, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { creatorWorkspaces } from "./creator-workspaces";
import { creatorMemberships } from "./creator-memberships";

export const creatorSubmissions = pgTable("creator_submissions", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => creatorWorkspaces.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull().references(() => creatorMemberships.id),
  taskId: text("task_id").notNull(),
  taskTitle: text("task_title").notNull(),
  platform: text("platform").notNull(),
  contentUrl: text("content_url").notNull(),
  contentKey: text("content_key").notNull(),
  description: text("description").notNull().default(""),
  evidenceUrl: text("evidence_url").notNull().default(""),
  activityDate: date("activity_date", { mode: "string" }).notNull(),
  weekStart: date("week_start", { mode: "string" }).notNull(),
  status: text("status").notNull().default("submitted"),
  score: integer("score").notNull().default(0),
  proposedScore: integer("proposed_score").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  dailyLimit: integer("daily_limit").notNull().default(1),
  weeklyCap: integer("weekly_cap").notNull().default(0),
  reviewNote: text("review_note").notNull().default(""),
  appealNote: text("appeal_note").notNull().default(""),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("creator_unique_activity").on(t.workspaceId, t.contentKey, t.taskId)]);
export const insertSubmissionSchema = createInsertSchema(creatorSubmissions).omit({ id: true, createdAt: true });
export type CreatorSubmission = typeof creatorSubmissions.$inferSelect;
