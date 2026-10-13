import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const EARLY_BETA_CUTOFF = new Date("2026-10-10T00:00:00Z");
export const earlyBetaEligible = (createdAt: Date) => createdAt.getTime() < EARLY_BETA_CUTOFF.getTime();

/** Grant by registration date, never by the date someone opens their profile. */
export async function grantEarlyBetaBadges(userId?: number) {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(182736450)`);
    await tx.execute(sql`
      insert into badges (user_id, badge_type, label, description)
      select u.id, 'early_beta', 'Early Beta User', 'Joined Monad Feet before October 10 2026'
      from users u
      where u.created_at < ${EARLY_BETA_CUTOFF}
      ${userId === undefined ? sql`` : sql`and u.id=${userId}`}
      and not exists (select 1 from badges b where b.user_id=u.id and b.badge_type='early_beta')
    `);
  });
}
