import { sql } from "drizzle-orm";
import { notifyUser } from "../presence";

export function parseDmUserId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

export function conversationListQuery(userId: number) {
  return sql`
    WITH ranked AS (
      SELECT
        dm.id, dm.content, dm.sender_id, dm.created_at,
        CASE WHEN dm.sender_id = ${userId} THEN dm.recipient_id ELSE dm.sender_id END AS other_id,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN dm.sender_id = ${userId} THEN dm.recipient_id ELSE dm.sender_id END
          ORDER BY dm.created_at DESC, dm.id DESC
        ) AS rn
      FROM direct_messages dm
      WHERE (dm.sender_id = ${userId} AND NOT dm.sender_hidden)
         OR (dm.recipient_id = ${userId} AND NOT dm.recipient_hidden)
    )
    SELECT
      r.other_id,
      r.content      AS last_content,
      r.sender_id    AS last_sender_id,
      r.created_at   AS last_at,
      u.name,
      u.username,
      u.avatar_url   AS "avatarUrl",
      u.dm_requires_subscription AS "dmRequiresSubscription",
      EXISTS(
        SELECT 1 FROM muted_users mu
        WHERE mu.user_id = ${userId} AND mu.muted_user_id = r.other_id
      ) AS "isMuted",
      EXISTS(
        SELECT 1 FROM blocked_users bu
        WHERE (bu.user_id = ${userId} AND bu.blocked_user_id = r.other_id)
           OR (bu.user_id = r.other_id AND bu.blocked_user_id = ${userId})
      ) AS "isBlocked",
      CASE
        WHEN EXISTS(
          SELECT 1 FROM muted_users mu
          WHERE mu.user_id = ${userId} AND mu.muted_user_id = r.other_id
        ) THEN 0
        ELSE (
          SELECT COUNT(*)::int FROM direct_messages d2
          WHERE d2.sender_id = r.other_id
            AND d2.recipient_id = ${userId}
            AND NOT d2.recipient_hidden
            AND d2.read_at IS NULL
        )
      END AS unread_count
    FROM ranked r
    JOIN users u ON u.id = r.other_id
    WHERE r.rn = 1
    -- last_at is an outer SELECT alias, not a column of ranked.
    ORDER BY r.created_at DESC, r.id DESC
  `;
}

export function hideConversationQuery(userId: number, otherId: number) {
  // One statement, one snapshot: a concurrent new message not covered by this
  // deletion remains visible. Never overwrite the counterpart's hide flag.
  return sql`
    UPDATE direct_messages
    SET sender_hidden = CASE WHEN sender_id = ${userId} THEN true ELSE sender_hidden END,
        recipient_hidden = CASE WHEN recipient_id = ${userId} THEN true ELSE recipient_hidden END
    WHERE (sender_id = ${userId} AND recipient_id = ${otherId})
       OR (sender_id = ${otherId} AND recipient_id = ${userId})
  `;
}

export function notifyDmParticipants(
  senderId: number,
  recipientId: number,
  event: Parameters<typeof notifyUser>[1],
  notify: typeof notifyUser = notifyUser,
): void {
  notify(recipientId, event);
  // Other signed sessions of the sender also need to refresh their inbox.
  notify(senderId, event);
}