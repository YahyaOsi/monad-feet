// Isolated in-memory DB and RPC: no sockets, wallet signing or live database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

test("registration routes: preflight, renamed recovery, signed identity, atomic races and idempotency", async () => {
  const names = ["usersTable", "verifiedRegistrationsTable", "inviteCodesTable", "streaksTable", "postsTable", "postLikesTable", "subscriptionsTable", "privatePostsTable"];
  const tables = Object.fromEntries(names.map(name => [name, new Proxy({ name }, { get: (t, key) => key === "name" ? t.name : `${name}.${String(key)}` })]));
  let rows, nextId, queue = Promise.resolve(), chainCalls, failInsert, failDiscovery, denyAttempt;
  const wallet = `0x${"11".repeat(20)}`, other = `0x${"22".repeat(20)}`, hash = `0x${"aa".repeat(32)}`;
  const reset = () => {
    rows = Object.fromEntries(names.map(name => [name, []])); nextId = 1; chainCalls = 0; failInsert = false; failDiscovery = false; denyAttempt = false;
    rows.inviteCodesTable.push({ id: 1, code: "FRESH", usedById: null, usedAt: null, ownerId: null });
  };
  const column = c => c.split(".")[1];
  const eq = (c, v) => r => r[column(c)] === v;
  const sql = (parts, ...args) => {
    if (parts.join("").includes("lower(trim(")) return r => r.username?.trim().toLowerCase() === args[1];
    return () => true;
  };
  const db = {
    select: projection => ({ from: table => ({ where: predicate => {
      const result = () => projection?.count ? [{ count: rows[table.name].filter(predicate).length }] : structuredClone(rows[table.name].filter(predicate));
      return { then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject), for: async () => result() };
    } }) }),
    execute: async () => {},
    insert: table => ({ values: value => {
      const apply = () => {
        if (failInsert) throw { cause: { cause: { code: "23505" } } };
        if (table.name === "usersTable" && rows.usersTable.some(r => r.walletAddress === value.walletAddress || r.username === value.username)) {
          throw { cause: { code: "23505" } };
        }
        const row = { id: nextId++, ...value };
        rows[table.name].push(row); return [row];
      };
      return { returning: async () => apply(), onConflictDoUpdate: async () => apply(),
        then: (resolve, reject) => Promise.resolve().then(apply).then(resolve, reject) };
    } }),
    update: table => ({ set: value => ({ where: predicate => {
      let result;
      const apply = () => {
        if (!result) {
          const matched = rows[table.name].filter(predicate);
          for (const row of matched) Object.assign(row, value);
          result = structuredClone(matched);
        }
        return result;
      };
      return { returning: async () => apply(),
        then: (resolve, reject) => Promise.resolve().then(apply).then(resolve, reject) };
    } }) }),
    transaction: callback => {
      const result = queue.then(async () => {
        const snapshot = structuredClone(rows);
        try { return await callback(db); } catch (error) { rows = snapshot; throw error; }
      });
      queue = result.catch(() => {}); return result;
    },
  };
  const verified = async user => rows.verifiedRegistrationsTable.some(r => r.userId === user.id && r.txHash === user.registrationTxHash);
  globalThis.__registrationFixture = {
    ...tables, db, eq, sql, and: (...predicates) => r => predicates.every(p => p(r)),
    isNull: c => r => r[column(c)] === null,
    isNotNull: c => r => r[column(c)] !== null && r[column(c)] !== undefined, verified,
    allowAttempt: (key, limit) => { assert.ok(key.startsWith("registration-prepare:")); assert.equal(limit, 6); return !denyAttempt; },
    discover: async () => { chainCalls++; if (failDiscovery) throw new Error("RPC unavailable"); return { registered: true, txHash: hash }; },
    verify: async (h, w) => { chainCalls++; return h === hash && (w === wallet || w === other); },
  };
  const folder = await mkdtemp(new URL("../../.registration-test-", import.meta.url));
  try {
    const bundle = await build({
      entryPoints: [new URL("../routes/users.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm",
      packages: "external", write: false,
      plugins: [{
        name: "isolated-registration",
        setup(b) {
          b.onResolve({ filter: /^(@workspace\/db|drizzle-orm)$|\/(walletAuth|contentPrivacy|registrationChain)$/ }, args => {
            // Keep real normalization/error handling, inject only chain operations.
            return { path: args.path, namespace: "fixture" };
          });
          b.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
            let contents;
            if (args.path === "@workspace/db") contents = `export const {db,${names.join(",")}}=globalThis.__registrationFixture;`;
            else if (args.path === "drizzle-orm") contents = `export const {eq,sql,and,isNull,isNotNull}=globalThis.__registrationFixture; export const ilike=eq,or=and,desc=x=>x;`;
            else if (args.path.endsWith("walletAuth")) contents = `export const hasVerifiedRegistration=globalThis.__registrationFixture.verified,allowAttempt=globalThis.__registrationFixture.allowAttempt;`;
            else if (args.path.endsWith("contentPrivacy")) contents = `export const bindNewImage=()=>{},viewerId=()=>null;`;
            else contents = `export {normalizeRegistrationUsername,isUniqueViolation} from ${JSON.stringify(new URL("./registrationChain.ts", import.meta.url).pathname)}; export const discoverRegistration=globalThis.__registrationFixture.discover,verifyRegistration=globalThis.__registrationFixture.verify;`;
            return { contents, loader: "js", resolveDir: new URL(".", import.meta.url).pathname };
          });
        },
      }],
    });
    const file = `${folder}/routes.mjs`;
    await writeFile(file, bundle.outputFiles[0].text);
    const { default: router } = await import(pathToFileURL(file));
    async function call(path, body, signed = wallet) {
      let status = 200, response;
      const handler = router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
      await handler({ body: { name: "Test user", ...body }, headers: signed ? { "x-wallet-address": signed } : {} }, {
        status(code) { status = code; return this; }, json(data) { response = data; },
      });
      return { status, body: response };
    }
    const prepare = body => call("/auth/registration/prepare", body);
    const register = (username = "new_handle", signed = wallet, invite = "FRESH") =>
      call("/auth/register", { walletAddress: signed, username, inviteCode: invite, txHash: hash }, signed);
    reset();
    rows.usersTable.push({ id: 99, username: "Taken", walletAddress: other });
    assert.equal((await prepare({ username: " TAKEN ", inviteCode: "FRESH" })).body.code, "USERNAME_TAKEN");
    assert.equal(chainCalls, 0, "duplicate preflight must happen before RPC/gas");
    denyAttempt = true;
    const limited = await prepare({ username: "new_handle", inviteCode: "FRESH" });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");
    assert.equal(chainCalls, 0);
    denyAttempt = false;
    assert.equal((await prepare({ username: "x", inviteCode: "FRESH" })).body.code, "INVALID_USERNAME");
    assert.equal((await prepare({ username: "new_handle", inviteCode: "bad" })).body.code, "INVALID_INVITE");
    assert.deepEqual((await prepare({ username: "new_handle", inviteCode: "FRESH" })).body, { registered: true, txHash: hash });
    failDiscovery = true;
    const unavailable = await prepare({ username: "new_handle", inviteCode: "FRESH" });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.code, "REGISTRATION_UNAVAILABLE");
    assert.equal("registered" in unavailable.body, false);
    failDiscovery = false;
    assert.equal((await call("/auth/register", { walletAddress: other, username: "new_handle", inviteCode: "FRESH", txHash: hash })).status, 403);
    assert.equal((await call("/auth/register", { walletAddress: wallet, username: "new_handle", inviteCode: "FRESH", txHash: `0x${"cc".repeat(32)}` })).status, 422);
    reset();
    const retries = await Promise.all([register(), register()]);
    assert.deepEqual(retries.map(r => r.status).sort(), [200, 201]);
    assert.equal(rows.usersTable.length, 1);
    assert.equal(rows.usersTable[0].username, "new_handle");
    assert.equal(rows.verifiedRegistrationsTable.length, 1);
    assert.equal(rows.streaksTable.length, 1);
    reset();
    rows.usersTable.push({ id: 99, username: "inviter", walletAddress: `0x${"33".repeat(20)}` });
    rows.inviteCodesTable[0].ownerId = 99;
    assert.equal((await register()).status, 201);
    assert.equal(rows.streaksTable.find(r => r.userId === 99).totalPoints, 10);
    assert.equal((await register()).status, 200);
    assert.equal(rows.streaksTable.filter(r => r.userId === 99).length, 1, "retry must not duplicate referral reward");
    reset();
    failInsert = true;
    assert.equal((await register()).body.code, "REGISTRATION_CONFLICT");
    assert.equal(rows.usersTable.length, 0);
    assert.equal(rows.inviteCodesTable[0].usedById, null);
    reset();
    assert.equal((await register()).status, 201);
    assert.equal(rows.inviteCodesTable[0].usedById, rows.usersTable[0].id);
    assert.equal((await prepare({ username: "another_handle", inviteCode: "used-or-missing" })).status, 200);
    assert.equal(rows.usersTable[0].username, "new_handle", "idempotency must not rename existing accounts");
    rows.verifiedRegistrationsTable = [];
    assert.equal((await prepare({ username: "new_handle", inviteCode: "FRESH" })).body.code, "UNVERIFIED_ACCOUNT");
    assert.equal((await register()).status, 409);
    reset();
    const race = await Promise.all([register("first_handle"), register("second_handle", other)]);
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
    assert.equal(rows.usersTable.length, 1, "losing invite redemption rolls back account and rewards");
    assert.equal(rows.streaksTable.length, 1);
    reset();
    rows.inviteCodesTable.push({ id: 2, code: "SECOND", usedById: null, usedAt: null, ownerId: null });
    const nameRace = await Promise.all([register(" SAME_NAME "), register("same_name", other, "SECOND")]);
    assert.deepEqual(nameRace.map(r => r.status).sort(), [201, 409]);
    assert.equal(nameRace.find(r => r.status === 409).body.code, "USERNAME_TAKEN");
    assert.equal(rows.inviteCodesTable.filter(r => r.usedById !== null).length, 1);
  } finally {
    delete globalThis.__registrationFixture;
    await rm(folder, { recursive: true, force: true });
  }
});