import { launchPolicy } from "./policy";

export const TREASURY = "0x23b4c6ddca73ba99045e1c0def939bd41932e773" as const;
export const CHAIN_ID = 143;
export const SAMPLE_BALANCE_WEI = 1000n * 10n ** 18n;
export const SAMPLE_POOL_WEI = SAMPLE_BALANCE_WEI * 55n / 100n;

export function weekFor(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { weekStart: start.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) };
}

export const initialTasks = [
  { id: "x_original", title: "Share your perspective on X", description: "Publish an original post about Monad Feet. Share a genuine experience, a useful guide or something your community should know.", platform: "X", score: 100, dailyLimit: 1, weeklyCap: 0, enabled: true, campaignTitle: "Introduce Monad Feet", campaignUrl: "https://x.com/MonadFeet", evidenceHint: "Link to your original X post. Account ownership must be verified." },
  { id: "telegram_post", title: "Start a conversation on Telegram", description: "Share a useful post in a group or channel where promotion is allowed. Respect the community and include promotional disclosures.", platform: "Telegram", score: 80, dailyLimit: 1, weeklyCap: 0, enabled: true, campaignTitle: "Meet the community", campaignUrl: "https://t.me/MonadFeet", evidenceHint: "Public message link or private group evidence link. Permission to post is reviewed separately." },
  { id: "feet_post", title: "Post inside Monad Feet", description: "Create an original daily post inside Monad Feet. Main app ownership, visibility and posting time must be checked by the existing backend.", platform: "Monad Feet", score: 40, dailyLimit: 1, weeklyCap: 0, enabled: true, campaignTitle: "Your daily contribution", campaignUrl: "https://monadfeet.social", evidenceHint: "Your main app post ID or link. Preview mode only simulates this check." },
  { id: "x_like", title: "Like an official campaign post", description: "Available only after the program owner reviews platform rules. No automated engagement.", platform: "X", score: 5, dailyLimit: 1, weeklyCap: 50, enabled: false, campaignTitle: "Policy review pending", campaignUrl: "https://x.com/MonadFeet", evidenceHint: "Designated official post and supporting evidence of your engagement." },
  { id: "x_repost", title: "Repost an official campaign post", description: "Available only after the program owner reviews platform rules. Share only designated campaign posts.", platform: "X", score: 10, dailyLimit: 1, weeklyCap: 50, enabled: false, campaignTitle: "Policy review pending", campaignUrl: "https://x.com/MonadFeet", evidenceHint: "Designated official post and supporting evidence of your repost." },
];

export function program() {
  return {
    name: "Monad Feet Creator Program", status: "draft", treasuryWallet: TREASURY,
    chainId: CHAIN_ID, poolPercent: 55, pointsPool: 1_000_000, ...weekFor(),
    rulesVersion: launchPolicy().ready ? "Owner approved configuration" : "Draft 1", integrationReady: launchPolicy().ready,
    announcement: launchPolicy().ready ? "Live participation requires an existing receipt verified Monad Feet account. MON allocations are not automatic payments." : "Dates, scoring and review deadlines await owner approval. Live participation is closed.",
  };
}

// Largest remainder, with stable member ID tie break. All calculations are integer based.
export function apportion(pool: bigint, scores: { id: number; score: number }[]) {
  const total = scores.reduce((sum, item) => sum + BigInt(item.score), 0n);
  if (total === 0n) return [];
  const parts = scores.map((item) => ({
    id: item.id, amount: pool * BigInt(item.score) / total,
    remainder: pool * BigInt(item.score) % total,
  }));
  let leftover = pool - parts.reduce((sum, item) => sum + item.amount, 0n);
  const order = [...parts].sort((a, b) => a.remainder === b.remainder ? a.id - b.id : a.remainder > b.remainder ? -1 : 1);
  for (const item of order) { if (leftover === 0n) break; item.amount += 1n; leftover -= 1n; }
  return parts.map(({ id, amount }) => ({ id, amount }));
}
