export const LIVE_PROGRAM_KEY = "monad-feet-creator-program";

function calendar(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) return null;
  return date.getTime();
}

// Explicit operator approval is required. A default date or sample scoring
// rule must never quietly start a live program.
export function launchPolicy(env: NodeJS.ProcessEnv = process.env) {
  const start = calendar(env.CREATOR_PROGRAM_START);
  const end = calendar(env.CREATOR_PROGRAM_END);
  const hours = Number(env.CREATOR_REVIEW_GRACE_HOURS);
  const ready = env.CREATOR_PROGRAM_ENABLED === "true" &&
    env.CREATOR_RULES_APPROVED === "true" && start !== null && end !== null &&
    end > start && end - start <= 366 * 86400000 &&
    env.CREATOR_REVIEW_GRACE_HOURS !== undefined && Number.isInteger(hours) && hours >= 24 && hours <= 168;
  return { ready, start: start ?? 0, end: end ?? 0, graceMs: hours * 3600000 };
}

export function isCreatorAdmin(wallet: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) return false;
  return (env.CREATOR_ADMIN_WALLETS ?? "").split(",").map((w) => w.trim().toLowerCase())
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w)).includes(wallet.toLowerCase());
}

export function activityInsideProgram(date: string, now = Date.now(), env: NodeJS.ProcessEnv = process.env) {
  const p = launchPolicy(env);
  const day = Date.parse(`${date}T00:00:00Z`);
  return p.ready && now >= p.start && now < p.end && day >= p.start && day < p.end && day <= now;
}

export function canFinalizeWeek(weekStart: string, now = Date.now(), env: NodeJS.ProcessEnv = process.env) {
  const p = launchPolicy(env);
  const start = calendar(weekStart);
  return p.ready && start !== null && start >= p.start && start < p.end && now >= start + 7 * 86400000 + p.graceMs;
}

export function canFinalizePoints(now = Date.now(), env: NodeJS.ProcessEnv = process.env) {
  const p = launchPolicy(env);
  return p.ready && now >= p.end + p.graceMs;
}
