import { pgTable, text, serial, timestamp, integer, boolean, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const postsTable = pgTable("posts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  onChainTxHash: text("on_chain_tx_hash"),
  chainVerifiedAt: timestamp("chain_verified_at", { withTimezone: true }),
  isPaid: boolean("is_paid").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true, createdAt: true });
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;

export const postDraftsTable = pgTable("post_drafts", {
  id: integer("id").primaryKey(),
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  content: text("content").notNull(),
  imageUrl: text("image_url").notNull(),
  isPaid: boolean("is_paid").notNull().default(false),
  contentUri: text("content_uri").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const postLikesTable = pgTable("post_likes", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => postsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  onChainTxHash: text("on_chain_tx_hash"),
  chainVerifiedAt: timestamp("chain_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull().references(() => postsTable.id),
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  content: text("content").notNull(),
  parentCommentId: integer("parent_comment_id").references((): AnyPgColumn => commentsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommentSchema = createInsertSchema(commentsTable).omit({ id: true, createdAt: true });
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;

export const privatePostsTable = pgTable("private_posts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPrivatePostSchema = createInsertSchema(privatePostsTable).omit({ id: true, createdAt: true });
export type InsertPrivatePost = z.infer<typeof insertPrivatePostSchema>;
export type PrivatePost = typeof privatePostsTable.$inferSelect;
