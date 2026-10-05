/** Rates apply to new actions only. Stored balances are never rescaled. */
export function dailyCheckinPoints(_streak: number, _verifiedNftHolder: boolean): number {
  return 10;
}

/** The referral number includes the just-completed, unique registration. */
export function referralPoints(referralNumber: number): number {
  return Math.min(Math.max(referralNumber, 0) * 10, 50);
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function previousUtcDay(date: Date): string {
  return utcDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1)));
}

export function xTaskReward(task: string): { points: number; invites: number } {
  return { points: task === "post_x" ? 10 : 5, invites: 0 };
}

export function claimable(existingDayKey: string | null, requestedDayKey: string): boolean {
  return existingDayKey !== requestedDayKey;
}