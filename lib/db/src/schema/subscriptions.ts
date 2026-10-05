import { pgTable, serial, timestamp, integer, numeric, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  subscriberId: integer("subscriber_id").notNull().references(() => usersTable.id),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id),
  pricePerMonth: numeric("price_per_month", { precision: 18, scale: 8 }).notNull(),
  consecutiveMonths: integer("consecutive_months").notNull().default(0),
  txHash: text("tx_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("subscriptions_subscriber_creator_unique").on(table.subscriberId, table.creatorId)]);

// Permanent replay ledger: the subscription row is overwritten on renewal, but
// every accepted payment hash must remain claimed forever.
export const subscriptionPaymentsTable = pgTable("subscription_payments", {
  txHash: text("tx_hash").primaryKey(),
  subscriberId: integer("subscriber_id").notNull().references(() => usersTable.id),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptionQuotesTable = pgTable("subscription_quotes", {
  id: text("id").primaryKey(),
  subscriberId: integer("subscriber_id").notNull().references(() => usersTable.id),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id),
  subscriberWallet: text("subscriber_wallet").notNull(),
  creatorWallet: text("creator_wallet").notNull(),
  price: numeric("price", { precision: 18, scale: 8 }).notNull(),
  chainId: integer("chain_id").notNull(),
  contract: text("contract").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedHash: text("consumed_hash").unique(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
