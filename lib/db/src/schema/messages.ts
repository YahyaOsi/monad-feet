import { pgTable, serial, integer, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const directMessagesTable = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => usersTable.id),
  recipientId: integer("recipient_id").notNull().references(() => usersTable.id),
  content: text("content").notNull(),
  // Inbox-only visibility. History remains readable by both participants, and
  // newly inserted messages resurface a conversation independently for each.
  senderHidden: boolean("sender_hidden").notNull().default(false),
  recipientHidden: boolean("recipient_hidden").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDirectMessageSchema = createInsertSchema(directMessagesTable).omit({ id: true, createdAt: true, senderHidden: true, recipientHidden: true });
export type InsertDirectMessage = z.infer<typeof insertDirectMessageSchema>;
export type DirectMessage = typeof directMessagesTable.$inferSelect;

export const mutedUsersTable = pgTable("muted_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  mutedUserId: integer("muted_user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("muted_users_unique").on(t.userId, t.mutedUserId)]);

export const blockedUsersTable = pgTable("blocked_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  blockedUserId: integer("blocked_user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("blocked_users_unique").on(t.userId, t.blockedUserId)]);
