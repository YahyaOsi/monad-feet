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
  const response = await fetch(`${base}/api/leaderboard?sortBy=points&period=${period}`);
  if (!response.ok) throw new Error("Could not load rankings. Please try again.");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected ranking data. Please try again.");
  return (data as LeaderEntry[]).slice(0, 25);
}