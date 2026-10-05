// Read-only mainnet eth_call simulations with EPHEMERAL state/code overrides.
// Nothing is deployed, signed, sent, or persisted. Run after verify-monad-v2.cjs.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireApi = createRequire(path.resolve("artifacts/api-server/package.json"));
const { encodeAbiParameters, encodeFunctionData, decodeFunctionResult, decodeEventLog, keccak256, toHex, parseEther } = requireApi("viem");
const soljson = require(path.resolve(process.argv[2]));
const compile = soljson.cwrap("solidity_compile", "string", ["string", "number", "number"]);
const registry = "0x616929D84ED483a26a568fC97A364e5c5eCBe39D";
const treasury = "0x23B4C6DdcA73ba99045E1c0Def939BD41932E773";
const actor = "0x0000000000000000000000000000000000001234";
const caller = "0x0000000000000000000000000000000000005678";
const creator = "0x0000000000000000000000000000000000009876";
async function rpc(method, params) {
  const response = await fetch("https://rpc.monad.xyz", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}
function slot(address, mapping) {
  return BigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [address, BigInt(mapping)])));
}
const word = (n) => toHex(BigInt(n), { size: 32 });
const source = `
pragma solidity ^0.8.24;
interface I {
  function playFeetGame(uint8) external payable;
  function subscribe(address) external payable;
  function getSubscriptionExpiry(address,address) external view returns(uint256);
  function gameStates(address) external view returns(uint256,uint8,uint8,uint8,uint256);
  function users(address) external view returns(bool,string memory,uint256,uint256,uint256,uint256,uint256,uint256,uint256,string memory,string memory,string memory);
}
contract Probe {
 I constant target = I(${registry});
 function run(uint8 action, uint256 n, uint256 fee) external returns(uint256 points, uint256 purchases, uint256 wash, uint256 massage, uint256 pedicure, uint256 streak, uint256 lastCheckin, uint256 received) {
   uint256 beforeBalance = ${treasury}.balance;
   for(uint256 i; i<n; ++i) target.playFeetGame{value:fee}(action);
   (,,, , ,points,streak, ,lastCheckin, , , )=target.users(address(this));
   (,uint8 w,uint8 m,uint8 p,uint256 t)=target.gameStates(address(this));
   return(points,t,w,m,p,streak,lastCheckin,${treasury}.balance-beforeBalance);
 }
 function sub(address creator, uint256 fee) external returns(uint256 expiry,uint256 creatorReceived,uint256 treasuryReceived) {
   uint256 beforeCreator = creator.balance;
   uint256 beforeTreasury = ${treasury}.balance;
   target.subscribe{value:fee}(creator);
   return(target.getSubscriptionExpiry(address(this),creator),creator.balance-beforeCreator,${treasury}.balance-beforeTreasury);
 }
}`;
(async () => {
  if (await rpc("eth_chainId", []) !== "0x8f") throw new Error("Wrong chain");
  const compiled = JSON.parse(compile(JSON.stringify({
    language: "Solidity", sources: { "Probe.sol": { content: source } },
    settings: { evmVersion: "osaka", viaIR: true, optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode"] } } },
  }), 0, 0));
  if (compiled.errors?.some((e) => e.severity === "error")) throw new Error(JSON.stringify(compiled.errors));
  const probe = compiled.contracts["Probe.sol"].Probe;
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const day = BigInt(block.timestamp) / 86400n;
  const userSlot = slot(actor, 0);
  const gameSlot = slot(actor, 5);
  const registryAbi = JSON.parse(fs.readFileSync("contracts/MonadFeetV2.abi.json", "utf8"));
  let passed = 0;
  async function run(label, action, count, fee, options = {}, expected, revertText) {
    const packedCounts = BigInt(options.wash || 0) + (BigInt(options.massage || 0) << 8n) + (BigInt(options.pedicure || 0) << 16n);
    const storage = {
      [word(userSlot)]: word(options.unregistered ? 0 : 1),
      [word(userSlot + 5n)]: word(0),
      [word(userSlot + 6n)]: word(0),
      [word(userSlot + 8n)]: word(0),
      [word(gameSlot)]: word(options.previousDay ? day - 1n : day),
      [word(gameSlot + 1n)]: word(packedCounts),
      [word(gameSlot + 2n)]: word(options.total || 0),
      [word(slot(creator, 0))]: word(1),
    };
    const overrides = {
      [registry]: { stateDiff: storage },
      [actor]: { code: `0x${probe.evm.deployedBytecode.object}`, balance: toHex(parseEther("100000")) },
      [caller]: { balance: toHex(parseEther("100000")) },
      // Leave the live treasury delegation in place, except the explicit rejecting-receiver test.
      ...(options.rejectTreasury ? { [treasury]: { code: "0x5f5ffd" } } : {}),
    };
    const functionName = options.subscription ? "sub" : "run";
    const data = encodeFunctionData({
      abi: probe.abi, functionName,
      args: options.subscription ? [creator, fee] : [action, BigInt(count), fee],
    });
    let result;
    try {
      const raw = await rpc("eth_call", [{ from: caller, to: actor, data, gas: "0x989680" }, block.number, overrides]);
      result = decodeFunctionResult({ abi: probe.abi, functionName, data: raw });
    } catch (error) {
      if (revertText && String(error).includes(revertText)) {
        console.log(`PASS ${label}: reverted (${revertText})`); passed++; return;
      }
      throw error;
    }
    if (revertText) throw new Error(`${label}: expected revert`);
    expected(result);
    if (options.invites !== undefined) {
      const trace = await rpc("debug_traceCall", [
        { from: caller, to: actor, data, gas: "0x989680" }, block.number,
        { tracer: "callTracer", tracerConfig: { withLog: true }, stateOverrides: overrides },
      ]);
      if (trace.error) throw new Error(JSON.stringify(trace));
      const logs = [];
      function gather(call) {
        for (const log of call.logs || []) if (log.address.toLowerCase() === registry.toLowerCase()) logs.push(log);
        for (const child of call.calls || []) gather(child);
      }
      gather(trace);
      const events = logs.map((log) => decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics }));
      equal(events.filter((event) => event.eventName === "InviteEarned").length, options.invites);
      equal(events.filter((event) => event.eventName === "GamePlayed").length, count);
    }
    console.log(`PASS ${label}: ${result.map(String).join(", ")}`); passed++;
  }
  function equal(actual, expected) {
    if (String(actual) !== String(expected)) throw new Error(`Expected ${expected}, got ${actual}`);
  }
  const fees = ["1.43", "14.3", "143"].map((fee) => parseEther(fee));
  const bases = [5n, 7n, 15n];
  for (let action = 1; action <= 3; action++) {
    const fee = fees[action - 1], base = bases[action - 1];
    await run(`action ${action} first purchase, live treasury accepts`, action, 1, fee, {}, (r) => {
      equal(r[0], base); equal(r[1], 1); equal(r[action + 1], 1);
      equal(r[5], 0); equal(r[6], 0); equal(r[7], fee);
    });
    await run(`action ${action} ten purchases, doubling sum`, action, 10, fee, {}, (r) => {
      equal(r[0], base * 1023n); equal(r[1], 10); equal(r[action + 1], 10); equal(r[7], fee * 10n);
    });
    await run(`action ${action} eleventh purchase denied`, action, 11, fee, {}, null,
      ["max wash limit", "max massage limit", "max pedicure limit"][action - 1]);
    await run(`action ${action} underpayment denied`, action, 1, fee - 1n, {}, null, "exact fee required");
    await run(`action ${action} overpayment denied`, action, 1, fee + 1n, {}, null, "exact fee required");
  }
  await run("UTC next day resets all per-item counts, preserves lifetime", 1, 1, fees[0],
    { wash: 10, massage: 10, pedicure: 10, previousDay: true, total: 30 }, (r) => {
      equal(r[0], 5); equal(r[1], 31); equal(r[2], 1); equal(r[3], 0); equal(r[4], 0);
    });
  await run("item limits independent", 2, 1, fees[1], { wash: 10 }, (r) => {
    equal(r[0], 7); equal(r[2], 10); equal(r[3], 1);
  });
  await run("unregistered denied", 1, 1, fees[0], { unregistered: true }, null, "not registered");
  await run("invalid action denied", 0, 1, fees[0], {}, null, "invalid game action");
  await run("treasury rejection reverts", 1, 1, fees[0], { rejectTreasury: true }, null, "fee transfer failed");
  await run("four purchases emit no invite", 1, 4, fees[0], { invites: 0 }, (r) => equal(r[1], 4));
  await run("fifth purchase emits one invite", 1, 5, fees[0], { invites: 1 }, (r) => equal(r[1], 5));
  await run("ten purchases emit two invites", 1, 10, fees[0], { invites: 2 }, (r) => equal(r[1], 10));
  await run("subscription accepts one wei (no creator price enforcement)", 0, 0, 1n, { subscription: true }, (r) => {
    equal(r[0], BigInt(block.timestamp) + 30n * 86400n); equal(r[1], 0); equal(r[2], 1);
  });
  await run("subscription 88/12 split", 0, 0, parseEther("1"), { subscription: true }, (r) => {
    equal(r[1], parseEther("0.88")); equal(r[2], parseEther("0.12"));
  });
  console.log(`TOTAL ${passed} read-only state-override simulations passed at block ${block.number}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });