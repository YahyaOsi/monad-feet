export interface LeaderEntry {
  rank: number;
  userId: number;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  totalPoints: number;
  currentStreak: number;
  subscriberCount: number;
  registrationTxHash?: string | null;
}

export type LeaderboardPeriod = "alltime" | "weekly";

export async function loadLeaderboard(base: string, period: LeaderboardPeriod): Promise<LeaderEntry[]> {
  const url = `${base}/api/leaderboard?sortBy=points&period=${period}`;
  let response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  // Retry a transient busy/cold-start response once, never an unbounded loop.
  if ([429, 502, 503, 504].includes(response.status)) {
    const seconds = Number(response.headers.get("Retry-After") ?? 1);
    await new Promise(resolve => setTimeout(resolve, Math.min(3, Math.max(1, Number.isFinite(seconds) ? seconds : 1)) * 1000));
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  }
  if (!response.ok) throw new Error("Could not load rankings. Please try again.");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected ranking data. Please try again.");
  return (data as LeaderEntry[]).slice(0, 25);
}