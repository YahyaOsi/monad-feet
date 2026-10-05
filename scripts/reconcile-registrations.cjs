// Development only. Dry run: node scripts/reconcile-registrations.cjs
// Apply: NODE_ENV=development node scripts/reconcile-registrations.cjs --apply-development
// Never sends transactions, changes users, or prints wallet/hash/username/invite data.
const { createRequire } = require("node:module");
const path = require("node:path");
const api = createRequire(path.resolve(__dirname, "../artifacts/api-server/package.json"));
const { createPublicClient, http, parseAbi, decodeFunctionData, decodeEventLog, keccak256 } = api("viem");
const registries = [
  "0x616929d84ed483a26a568fc97a364e5c5ecbe39d",
  "0x9cab57e02968cb870555692cc3250fbe99cd8401",
  "0xf900b968ed0325a304bd0472a0e27322f4a918a0",
];
const abi = parseAbi([
  "function registerUser(string username, string inviteCode)",
  "function users(address) view returns (bool registered, string username, uint256 registeredAt, uint256 postCount, uint256 likesSent, uint256 streakPoints, uint256 currentStreak, uint256 longestStreak, uint256 lastCheckin, string name, string bio, string avatarUri)",
  "event UserRegistered(address indexed wallet, string username, uint256 timestamp)",
]);
function requireEvidence(ok, reason) { if (!ok) throw new Error(reason); }
function hashStatus(hash) {
  return !hash ? "missing_hash" : /^0x[0-9a-fA-F]{64}$/.test(hash) ? null : "malformed_hash";
}
function evidenceStatus(existing, user) {
  if (existing.some(e => e.user_id === user.id && e.tx_hash.toLowerCase() === user.registration_tx_hash.toLowerCase())) return "already_verified";
  if (existing.some(e => e.user_id === user.id || e.tx_hash.toLowerCase() === user.registration_tx_hash.toLowerCase())) return "replay_conflict";
  return null;
}
function validate(user, tx, receipt, block, state, invites) {
  const wallet = user.wallet_address.toLowerCase();
  const registry = tx.to?.toLowerCase();
  requireEvidence(registries.includes(registry), "wrong_registry");
  requireEvidence(receipt.status === "success", "reverted");
  requireEvidence(tx.chainId === 143 && tx.value === 0n, "wrong_chain_or_value");
  requireEvidence(tx.hash.toLowerCase() === user.registration_tx_hash.toLowerCase() &&
    receipt.transactionHash.toLowerCase() === tx.hash.toLowerCase() &&
    tx.blockHash === receipt.blockHash && block.hash === receipt.blockHash, "inconsistent_receipt");
  requireEvidence(tx.from.toLowerCase() === wallet && receipt.from.toLowerCase() === wallet &&
    receipt.to?.toLowerCase() === registry, "identity_mismatch");
  let call;
  try { call = decodeFunctionData({ abi, data: tx.input }); } catch { throw new Error("invalid_calldata"); }
  requireEvidence(call.functionName === "registerUser" && call.args[0] === user.username, "identity_mismatch");
  // An old nft_holder boolean is not historical ownership evidence. Fail closed:
  // every recovered account needs its original, durably redeemed invitation.
  requireEvidence(invites.some(i => i.used_by_id === user.id && i.used_at &&
    i.code.toUpperCase() === call.args[1].toUpperCase()), "missing_admission_evidence");
  const events = receipt.logs.filter(l => l.address.toLowerCase() === registry).flatMap(l => {
    try { const e = decodeEventLog({ abi, ...l }); return e.eventName === "UserRegistered" ? [e] : []; }
    catch { return []; }
  });
  requireEvidence(events.length === 1 && events[0].args.wallet.toLowerCase() === wallet &&
    events[0].args.username === user.username && events[0].args.timestamp === block.timestamp, "invalid_registered_event");
  requireEvidence(state[0] === true && state[1] === user.username && state[2] === block.timestamp, "live_state_mismatch");
  return registry;
}
function executableHash(code) {
  requireEvidence(code && code.length > 6, "registry_compatibility_unverified");
  const metadataBytes = parseInt(code.slice(-4), 16) + 2;
  requireEvidence(metadataBytes * 2 < code.length - 2, "registry_compatibility_unverified");
  return keccak256(code.slice(0, -metadataBytes * 2));
}
async function main() {
  const args = process.argv.slice(2);
  requireEvidence(args.every(a => a === "--apply-development") && args.length <= 1, "invalid_arguments");
  const apply = args.includes("--apply-development");
  // The provisioned workspace development database is local helium, never a
  // deployment/external database. Do not add a bypass for production URLs.
  const url = new URL(process.env.DATABASE_URL);
  requireEvidence(!process.env.REPLIT_DEPLOYMENT && process.env.NODE_ENV !== "production" &&
    url.hostname === "helium" && url.pathname === "/heliumdb", "development_database_required");
  requireEvidence(!apply || process.env.NODE_ENV === "development", "explicit_development_environment_required");
  const { Client } = createRequire(path.resolve(__dirname, "../lib/db/package.json"))("pg");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const rpc = createPublicClient({ transport: http("https://rpc.monad.xyz", { retryCount: 1, timeout: 15000 }) });
  const report = { version: 1, environment: "development", mode: apply ? "apply" : "dry-run", chainId: 143,
    snapshotBlock: null, checked: 0, eligible: 0, inserted: 0, blocked: 0, reasons: {}, registries: {},
    recovery: "Missing hashes require the original public transaction hash from wallet history and redeemed app-invite evidence, followed by this dry run. Never auto-register, sign, pay, alter identity, or migrate post history. Unverifiable evidence requires manual review; no auth bypass." };
  const count = reason => { report.reasons[reason] = (report.reasons[reason] || 0) + 1; };
  try {
    await db.connect();
    await db.query("BEGIN");
    // Serialize app registration and reconciliation, including invitation evidence.
    if (apply) await db.query("LOCK TABLE users, invite_codes, verified_registrations IN SHARE ROW EXCLUSIVE MODE");
    const users = (await db.query("SELECT id, wallet_address, username, registration_tx_hash FROM users ORDER BY id")).rows;
    const existing = (await db.query("SELECT user_id, tx_hash FROM verified_registrations")).rows;
    const invites = (await db.query("SELECT code, used_by_id, used_at FROM invite_codes WHERE used_by_id IS NOT NULL")).rows;
    let snapshot;
    for (const user of users) {
      report.checked++;
      const early = hashStatus(user.registration_tx_hash) || evidenceStatus(existing, user);
      if (early) { count(early); if (early !== "already_verified") report.blocked++; continue; }
      if (users.some(other => other.id !== user.id && other.registration_tx_hash?.toLowerCase() === user.registration_tx_hash.toLowerCase())) {
        count("replay_conflict"); report.blocked++; continue;
      }
      try {
        requireEvidence(await rpc.getChainId() === 143, "wrong_rpc_chain");
        if (!snapshot) { snapshot = await rpc.getBlock({ blockTag: "finalized" }); report.snapshotBlock = snapshot.number.toString(); }
        const hash = user.registration_tx_hash;
        const tx = await rpc.getTransaction({ hash });
        const receipt = await rpc.getTransactionReceipt({ hash });
        requireEvidence(registries.includes(tx.to?.toLowerCase()), "wrong_registry");
        requireEvidence(receipt.status === "success", "reverted");
        requireEvidence(receipt.blockNumber <= snapshot.number, "not_finalized");
        const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
        const code = await rpc.getCode({ address: tx.to, blockNumber: snapshot.number });
        const codeHash = executableHash(code);
        // Source-verified V2 executable fingerprint (docs/contract-verification.md).
        // Historical addresses are NOT trusted just because they were configured:
        // only identical verified executable code is presently accepted there.
        requireEvidence(codeHash === "0x9fed459d0f653d43fd8fd3a3a7714700c3f914c8d20f2bb066aa3f3f43b56b06", "registry_compatibility_unverified");
        requireEvidence(await rpc.getCode({ address: tx.to, blockNumber: receipt.blockNumber }) === code, "registry_code_changed");
        const state = await rpc.readContract({ address: tx.to, abi, functionName: "users", args: [user.wallet_address], blockNumber: snapshot.number });
        const registry = validate(user, tx, receipt, block, state, invites);
        report.registries[registry] = { executableCodeHash: codeHash, accepted: (report.registries[registry]?.accepted || 0) + 1 };
        report.eligible++;
        if (apply) {
          try {
            await db.query("INSERT INTO verified_registrations(user_id, tx_hash) VALUES ($1,$2)", [user.id, hash.toLowerCase()]);
          } catch {
            // A failed SQL statement aborts the transaction. Never subsequently
            // report earlier staged inserts as committed.
            throw Object.assign(new Error("database_write_failed"), { fatal: true });
          }
          report.inserted++;
        }
        existing.push({ user_id: user.id, tx_hash: hash.toLowerCase() });
        count("verified_original_evidence");
      } catch (error) {
        if (error.fatal) throw error;
        const safeReasons = ["wrong_rpc_chain", "wrong_registry", "reverted", "not_finalized", "registry_compatibility_unverified", "registry_code_changed",
          "wrong_chain_or_value", "inconsistent_receipt", "identity_mismatch", "invalid_calldata", "missing_admission_evidence", "invalid_registered_event", "live_state_mismatch"];
        count(safeReasons.includes(error.message) ? error.message : "unverifiable_rpc_or_database_evidence");
        report.blocked++;
      }
    }
    await db.query(apply ? "COMMIT" : "ROLLBACK");
    console.log(JSON.stringify(report, null, 2));
  } finally { await db.end(); }
}
module.exports = { abi, registries, hashStatus, evidenceStatus, validate, executableHash };
if (require.main === module) main().catch(() => { console.error("Reconciliation aborted; no successful report. Check development target/configuration; sensitive error details suppressed."); process.exitCode = 1; });