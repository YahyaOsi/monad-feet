// Deterministic tests of the real client hook. No wallet, RPC, DB or browser
// is contacted. Bundle in-memory with its external boundaries substituted.
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const clientDir = fileURLToPath(new URL("../../../monad-feet/src/", import.meta.url));
const mocks = {
  react: `export const useEffect=()=>{}; export const useRef=x=>({current:x}); export const useState=x=>[typeof x==='function'?x():x,()=>{}];`,
  wagmi: `export const useAccount=()=>({address:globalThis.__pub.wallet,chainId:143}); export const usePublicClient=()=>({waitForTransactionReceipt:async()=>({status:globalThis.__pub.receipt})});`,
  "@/context/UserContext": `export const useUser=()=>({user:{walletAddress:globalThis.__pub.wallet}});`,
  "@/lib/useContractActions": `export const useContractActions=()=>({createPostOnChain:async(id,uri,onSubmitted)=>{globalThis.__pub.writes++;onSubmitted(globalThis.__pub.hash);return globalThis.__pub.hash;}});`,
  "@tanstack/react-query": `export const useQueryClient=()=>({invalidateQueries:async()=>{globalThis.__pub.invalidated++;}});`,
};
const bundle = await build({
  entryPoints: [clientDir + "hooks/usePostPublication.ts"],
  bundle: true, write: false, format: "esm", platform: "node",
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: [{ name: "test-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (mocks[args.path]) return { path: args.path, namespace: "mock" };
      if (args.path.startsWith("@/")) return { path: clientDir + args.path.slice(2) + ".ts" };
    });
    builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }],
});
const { usePostPublication } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const wallet = "0x" + "11".repeat(20);
const hash = "0x" + "ab".repeat(32);
const key = `mf-publication:143:0x616929d84ed483a26a568fc97a364e5c5ecbe39d:${wallet}`;
const draft = { postId: 98, contentUri: "original", content: "original caption", imageUrl: "/api/storage/original", isPaid: true };
function setup({ anchored = true, status = 200, finalStatus = 200, storedHash, receipt = "success", rejectFirstHash = false } = {}) {
  const items = new Map([[key, JSON.stringify({ ...draft, ...(storedHash ? { hash: storedHash } : {}) })]]);
  globalThis.__pub = { wallet, hash, writes: 0, invalidated: 0, receipt, requests: [] };
  globalThis.localStorage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
  globalThis.window = new EventTarget();
  globalThis.fetch = async (url, init) => {
    globalThis.__pub.requests.push({ url, body: JSON.parse(init.body) });
    const recover = url.endsWith("/recover");
    const code = !recover && rejectFirstHash && JSON.parse(init.body).txHash !== hash ? 422 : recover ? status : finalStatus;
    return { ok: code === 200, status: code, json: async () => code !== 200 ? { error: "RPC unavailable" } :
      recover ? { anchored, txHash: anchored ? hash : null } : { id: 98 } };
  };
  return { hook: usePostPublication(), items, state: globalThis.__pub };
}
test("hash missing after wallet confirmation: recover then finalize original content, never sign again", async () => {
  const f = setup();
  assert.deepEqual(await f.hook.publish(), { id: 98 });
  assert.equal(f.state.writes, 0);
  assert.equal(f.items.has(key), false);
  assert.equal(f.state.invalidated, 1);
  assert.deepEqual(f.state.requests[1].body, { postId: 98, txHash: hash, content: draft.content, imageUrl: draft.imageUrl, isPaid: true, authorWalletAddress: wallet });
});
test("recovery outage cannot trigger another wallet transaction or lose draft", async () => {
  const f = setup({ status: 503 });
  await assert.rejects(f.hook.publish(), /RPC unavailable/);
  assert.equal(f.state.writes, 0);
  assert.equal(JSON.parse(f.items.get(key)).content, draft.content);
});
test("finalization failure retains recovered hash for later retry", async () => {
  const f = setup({ finalStatus: 503 });
  await assert.rejects(f.hook.publish(), /RPC unavailable/);
  assert.equal(f.state.writes, 0);
  assert.equal(JSON.parse(f.items.get(key)).hash, hash);
});
test("confirmed-hash fallback bypasses discovery, but still finalizes through server verification", async () => {
  const f = setup({ status: 503 });
  await f.hook.publish(undefined, hash);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].url, "/api/posts");
});
test("discard preserves a confirmed chain publication and its recovered hash", async () => {
  const f = setup();
  await assert.rejects(f.hook.discard(), /already confirmed/);
  assert.equal(JSON.parse(f.items.get(key)).hash, hash);
  assert.equal(f.state.writes, 0);
});
test("unsubmitted draft can be discarded only after a successful negative chain check", async () => {
  const f = setup({ anchored: false });
  await f.hook.discard();
  assert.equal(f.items.has(key), false);
});
test("unanchored draft requests one signature, persists and finalizes", async () => {
  const f = setup({ anchored: false });
  await f.hook.publish();
  assert.equal(f.state.writes, 1);
  assert.equal(f.items.has(key), false);
});
test("reverted receipt keeps draft but removes failed hash for an explicit retry", async () => {
  const f = setup({ storedHash: hash, receipt: "reverted" });
  await assert.rejects(f.hook.publish(), /reverted/);
  assert.equal(f.state.writes, 0);
  assert.equal(JSON.parse(f.items.get(key)).hash, undefined);
});
test("historical card replaces a stale stored hash automatically and never asks to sign again", async () => {
  const f = setup({ storedHash: "0x" + "cd".repeat(32) });
  await f.hook.publish({ legacyPostId: 98 });
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.requests[0].url, "/api/posts/recover");
  assert.equal(f.state.requests[1].body.txHash, hash);
  assert.equal(f.items.has(key), false);
});
test("Feed retry recovers a mismatched saved hash after server rejection without another signature", async () => {
  const f = setup({ storedHash: "0x" + "cd".repeat(32), rejectFirstHash: true });
  await f.hook.publish();
  assert.equal(f.state.writes, 0);
  assert.deepEqual(f.state.requests.map(r => r.url), ["/api/posts", "/api/posts/recover", "/api/posts"]);
  assert.equal(f.state.requests[2].body.txHash, hash);
  assert.equal(f.items.has(key), false);
});
test("mismatched hash with no chain publication is cleared only after negative chain check, without automatic signing", async () => {
  const f = setup({ anchored: false, storedHash: "0x" + "cd".repeat(32), rejectFirstHash: true });
  await assert.rejects(f.hook.publish(), /Tap Finish publishing/);
  assert.equal(f.state.writes, 0);
  assert.equal(JSON.parse(f.items.get(key)).hash, undefined);
});
test("recovery outage after mismatched hash keeps the original reference and cannot sign", async () => {
  const wrong = "0x" + "cd".repeat(32);
  const f = setup({ status: 503, storedHash: wrong, rejectFirstHash: true });
  await assert.rejects(f.hook.publish(), /RPC unavailable/);
  assert.equal(f.state.writes, 0);
  assert.equal(JSON.parse(f.items.get(key)).hash, wrong);
});
