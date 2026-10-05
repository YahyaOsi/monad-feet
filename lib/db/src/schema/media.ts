import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Server-issued provenance only. Binding is one-way; deletion never makes an
// object public again. Legacy objects are resolved read-only from references.
export const mediaObjectsTable = pgTable("media_objects", {
  objectPath: text("object_path").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id),
  visibility: text("visibility").notNull().default("unbound"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});