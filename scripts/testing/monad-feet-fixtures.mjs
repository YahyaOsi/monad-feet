/*
 * TEST ONLY — import into a Playwright test. No network API/RPC is contacted.
 * The fixture address has no known key, and fake hashes are NOT real payments.
 */
export const ADDRESS = "0x1111111111111111111111111111111111111111";
export const CONTRACT = "0x616929D84ED483a26a568fC97A364e5c5eCBe39D";
export const TREASURY = "0x23B4C6DdcA73ba99045E1c0Def939BD41932E773";
export const FAKE_HASH = `0x${"ab".repeat(32)}`;

/** Call before page.goto; origin is the preview URL origin, not the API origin. */
export async function installMonadFeetFixtures(context, origin) {
  const allowedOrigin = new URL(origin).origin;
  const state = { claimMode: "success", claims: [], totalPurchases: 0, enabled: true };
  const user = {
    id: 90001, walletAddress: ADDRESS, name: "Isolated Tester",
    username: "isolated_tester", email: null, avatarUrl: null, bio: null,
    subscriptionPrice: null, registrationTxHash: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const json = (route, body, status = 200) => route.fulfill({
    status, contentType: "application/json", body: JSON.stringify(body),
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== allowedOrigin) {
      return route.abort("blockedbyclient"); // includes RPC, WalletConnect and analytics
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/auth/session" && method === "GET")
      return json(route, { walletAddress: ADDRESS });
    if (path === "/api/auth/challenge" && method === "POST")
      return json(route, { message: "Isolated test challenge; not a real sign-in" });
    if (path === "/api/auth/verify" && method === "POST")
      return json(route, { walletAddress: ADDRESS });
    if (path === "/api/auth/logout" && method === "POST")
      return json(route, {}, 200);
    if (path === "/api/users/me" && method === "GET") return json(route, user);
    if (path === "/api/game" && method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      const next = new Date(`${today}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const prices = ["1.43", "14.3", "143"];
      const names = ["Wash", "Massage", "Pedicure"];
      return json(route, {
        contractAddress: CONTRACT, treasuryAddress: TREASURY, chainId: 143,
        enabled: state.enabled, disabledReason: state.enabled ? "" : "Test: game disabled",
        registered: true, utcDay: today, nextResetAt: next.toISOString(),
        totalPurchases: state.totalPurchases, purchasesUntilInvite: 5 - state.totalPurchases % 5,
        onChainPoints: state.claims.length * 5, currentStreak: 0, longestStreak: 0,
        checkedInToday: false,
        actions: names.map((name, index) => ({
          id: index + 1, name, priceMon: prices[index],
          basePoints: [5, 7, 15][index], count: 0, remaining: 10,
          nextPoints: [5, 7, 15][index],
        })),
      });
    }
    if (path === "/api/game/claims" && method === "GET")
      return json(route, { claims: state.claims });
    if (path === "/api/game/claims" && method === "POST") {
      const hash = JSON.parse(request.postData() || "{}").txHash;
      if (!/^0x[0-9a-f]{64}$/i.test(hash || ""))
        return json(route, { error: "A valid transaction hash is required" }, 400);
      if (state.claimMode === "unavailable")
        return json(route, { error: "Monad verification unavailable; keep this hash and retry. Do not pay again." }, 503);
      if (state.claimMode === "invalid" || hash.toLowerCase() !== FAKE_HASH)
        return json(route, { error: "Test receipt invalid: no verified payment" }, 422);
      const previous = state.claims.find(c => c.txHash.toLowerCase() === hash.toLowerCase());
      if (!previous) {
        state.claims.unshift({
          txHash: hash, pointsAwarded: 5, invitesAwarded: 0,
          createdAt: new Date().toISOString(),
        });
        state.totalPurchases++;
      }
      return json(route, { alreadyClaimed: !!previous, pointsAwarded: previous ? 0 : 5, invitesAwarded: 0, inviteCodes: [] });
    }
    if (path === "/api/streak" && method === "GET")
      return json(route, { userId: user.id, currentStreak: 0, longestStreak: 0,
        totalPoints: 0, lastCheckin: null, checkedInToday: false,
        extraInviteEarned: false, lastCheckinTxHash: null });
    // Never leak unlisted API calls into the real server.
    return json(route, { error: `Unmocked isolated API: ${method} ${path}` }, 501);
  });
  return { state, user };
}