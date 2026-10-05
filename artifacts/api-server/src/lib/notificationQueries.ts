import { and, count, desc, eq, notInArray } from "drizzle-orm";
import type { db } from "@workspace/db";
import {
  notificationsTable, usersTable, type NotificationPreferences,
} from "@workspace/db/schema";

export function buildNotificationQueries(
  database: Pick<typeof db, "select">,
  userId: number,
  prefs: Pick<NotificationPreferences, "likesEnabled" | "subscriptionsEnabled" | "badgesEnabled" | "systemEnabled">,
) {
  const disabledTypes: string[] = [];
  if (!prefs.likesEnabled) disabledTypes.push("like");
  if (!prefs.subscriptionsEnabled) disabledTypes.push("subscription");
  if (!prefs.badgesEnabled) disabledTypes.push("badge");
  if (!prefs.systemEnabled) disabledTypes.push("system");
  const visible = and(
    eq(notificationsTable.userId, userId),
    disabledTypes.length ? notInArray(notificationsTable.type, disabledTypes) : undefined,
  );
  return {
    list: database.select({
      id: notificationsTable.id,
      userId: notificationsTable.userId,
      type: notificationsTable.type,
      title: notificationsTable.title,
      body: notificationsTable.body,
      actorId: notificationsTable.actorId,
      resourceId: notificationsTable.resourceId,
      resourceType: notificationsTable.resourceType,
      read: notificationsTable.read,
      createdAt: notificationsTable.createdAt,
      actorName: usersTable.name,
      actorUsername: usersTable.username,
      actorAvatarUrl: usersTable.avatarUrl,
    })
      .from(notificationsTable)
      .leftJoin(usersTable, eq(usersTable.id, notificationsTable.actorId))
      .where(visible)
      .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
      .limit(50),
    // The count must cover ALL visible unread records, not just the newest page.
    unread: database.select({ count: count() })
      .from(notificationsTable)
      .where(and(visible, eq(notificationsTable.read, false))),
  };
}