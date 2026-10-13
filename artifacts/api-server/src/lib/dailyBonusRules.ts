export const DAILY_BONUS_TASKS = [
  { id: "checkin", title: "Check in today", points: 30, target: 1, href: "/daily" },
  { id: "post", title: "Publish a post", points: 70, target: 1, href: "/feed" },
  { id: "subscribe", title: "Subscribe to a creator", points: 500, target: 1, href: "/search" },
  { id: "exclusive", title: "Publish exclusive content", points: 200, target: 1, href: "/private" },
  { id: "likes", title: "Like three posts from other people", points: 40, target: 3, href: "/feed" },
  { id: "comment", title: "Comment on a post", points: 50, target: 1, href: "/feed" },
  { id: "photo", title: "Share a photo in a public post", points: 80, target: 1, href: "/feed" },
  { id: "reply", title: "Reply to another person", points: 60, target: 1, href: "/feed" },
  { id: "support", title: "Like five posts from other people", points: 80, target: 5, href: "/feed" },
  { id: "discuss", title: "Comment on three different posts", points: 100, target: 3, href: "/feed" },
  { id: "invite", title: "Help a friend join with your invite code", points: 150, target: 1, href: "/wallet" },
  { id: "spa", title: "Enjoy a foot spa visit", points: 50, target: 1, href: "/daily" },
] as const;

export function dailyBonusTask(now: Date) {
  // A common UTC schedule for everyone. No client clock decides eligibility.
  const day = Math.floor(now.getTime() / 86_400_000);
  const start = Math.floor(Date.parse("2026-10-06T00:00:00Z") / 86_400_000);
  return DAILY_BONUS_TASKS[((day - start) % DAILY_BONUS_TASKS.length + DAILY_BONUS_TASKS.length) % DAILY_BONUS_TASKS.length];
}
