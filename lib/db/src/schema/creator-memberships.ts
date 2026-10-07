import { pgTable, serial, text, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { creatorWorkspaces } from "./creator-workspaces";
import { usersTable } from "./users";

export const creatorMemberships = pgTable("creator_memberships", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => creatorWorkspaces.id, { onDelete: "cascade" }),
  mainUserId: integer("main_user_id").references(() => usersTable.id),
  name: text("name").notNull(),
  handle: text("handle").notNull(),
  wallet: text("wallet"),
  status: text("status").notNull().default("not_applied"),
  xHandle: text("x_handle").notNull().default(""),
  telegramHandle: text("telegram_handle").notNull().default(""),
  xVerified: boolean("x_verified").notNull().default(false),
  telegramVerified: boolean("telegram_verified").notNull().default(false),
  verificationCode: text("verification_code").notNull(),
  badge: boolean("badge").notNull().default(false),
  groupStatus: text("group_status").notNull().default("not_requested"),
  bio: text("bio").notNull().default(""),
  channels: text("channels").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  pointsAllocated: integer("points_allocated").notNull().default(0),
}, (t) => [uniqueIndex("creator_membership_main_user").on(t.workspaceId, t.mainUserId)]);
export const insertMembershipSchema = createInsertSchema(creatorMemberships).omit({ id: true });
export type CreatorMembership = typeof creatorMemberships.$inferSelect;
