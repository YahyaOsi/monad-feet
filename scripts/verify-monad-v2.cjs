// Read-only verification. No signing keys, transactions, or persistent chain writes.
// Download the official soljson-v0.8.34+commit.80d5c536.js and pass its local path:
// node scripts/verify-monad-v2.cjs /tmp/monad-soljson-0.8.34.cjs
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireApi = createRequire(path.resolve("artifacts/api-server/package.json"));
const { keccak256 } = requireApi("viem");
const soljson = require(path.resolve(process.argv[2]));
const compile = soljson.cwrap("solidity_compile", "string", ["string", "number", "number"]);
const address = "0x616929D84ED483a26a568fC97A364e5c5eCBe39D";
const treasury = "23b4c6ddca73ba99045e1c0def939bd41932e773";
async function rpc(method, params) {
  const response = await fetch("https://rpc.monad.xyz", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}
function withoutMetadata(hex) {
  const bytes = Number.parseInt(hex.slice(-4), 16) + 2;
  return hex.slice(0, -bytes * 2);
}
(async () => {
  const version = soljson.cwrap("solidity_version", "string", [])();
  if (!version.startsWith("0.8.34+commit.80d5c536")) throw new Error("Wrong solc version");
  const block = await rpc("eth_blockNumber", []);
  const chain = await rpc("eth_chainId", []);
  if (chain !== "0x8f") throw new Error("Wrong chain");
  const live = (await rpc("eth_getCode", [address, block])).slice(2).toLowerCase();
  const input = {
    language: "Solidity",
    sources: { "MonadFeetV2.sol": { content: fs.readFileSync("contracts/MonadFeetV2.sol", "utf8") } },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      evmVersion: "osaka",
      outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode", "storageLayout"] } },
    },
  };
  const output = JSON.parse(compile(JSON.stringify(input), 0, 0));
  if (output.errors?.some((error) => error.severity === "error")) throw new Error(JSON.stringify(output.errors));
  const contract = output.contracts["MonadFeetV2.sol"].MonadFeet;
  let expected = contract.evm.deployedBytecode.object.toLowerCase();
  for (const references of Object.values(contract.evm.deployedBytecode.immutableReferences)) {
    for (const { start, length } of references) {
      expected = expected.slice(0, start * 2) + treasury.padStart(length * 2, "0") + expected.slice((start + length) * 2);
    }
  }
  const matches = withoutMetadata(live) === withoutMetadata(expected);
  const result = {
    compiler: version, settings: input.settings, chainId: 143, block,
    address, runtimeBytes: live.length / 2,
    runtimeCodeHash: keccak256(`0x${live}`),
    executableCodeHash: keccak256(`0x${withoutMetadata(live)}`),
    immutableReferences: contract.evm.deployedBytecode.immutableReferences,
    executableMatches: matches, fullRuntimeMatches: live === expected,
    treasuryCode: await rpc("eth_getCode", [`0x${treasury}`, block]),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!matches) throw new Error("Executable bytecode mismatch");
  // Generated artifacts only; the supplied Solidity source is never rewritten.
  fs.writeFileSync("contracts/MonadFeetV2.abi.json", `${JSON.stringify(contract.abi, null, 2)}\n`);
  fs.writeFileSync("/tmp/monad-v2-compiled.json", JSON.stringify(contract));
  fs.writeFileSync("/tmp/monad-v2-verification.json", JSON.stringify(result, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });