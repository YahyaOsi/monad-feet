import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  type: text("type").notNull(), // 'like' | 'subscription' | 'badge' | 'system'
  title: text("title").notNull(),
  body: text("body").notNull(),
  actorId: integer("actor_id").references(() => usersTable.id),
  resourceId: integer("resource_id"),
  resourceType: text("resource_type"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

export const notificationPreferencesTable = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id),
  likesEnabled: boolean("likes_enabled").notNull().default(true),
  subscriptionsEnabled: boolean("subscriptions_enabled").notNull().default(true),
  badgesEnabled: boolean("badges_enabled").notNull().default(true),
  systemEnabled: boolean("system_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferencesTable).omit({ id: true });
export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;
export type NotificationPreferences = typeof notificationPreferencesTable.$inferSelect;
