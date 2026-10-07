import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { creatorWorkspaces } from "./creator-workspaces";
import { creatorMemberships } from "./creator-memberships";

// The shared live program is not an authentication session. Each browser
// session has its own opaque, hashed token and authenticated member.
export const creatorSessions = pgTable("creator_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => creatorWorkspaces.id),
  memberId: integer("member_id").notNull().references(() => creatorMemberships.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
