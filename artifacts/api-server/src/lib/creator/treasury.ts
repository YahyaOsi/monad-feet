import { CHAIN_ID, TREASURY } from "./config";
import { logger } from "../logger";

type TreasuryResult = { wallet: string; chainId: number; status: "live" | "unavailable"; balanceWei: string | null; poolWei: string | null; blockNumber: string | null; fetchedAt: string; error: string | null };
let cached: { result: TreasuryResult; expires: number } | undefined;
let pending: Promise<TreasuryResult> | undefined;
async function rpc(method: string, params: unknown[]) {
  const response = await fetch("https://rpc.monad.xyz", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("RPC request failed");
  const data = await response.json() as { result?: string; error?: unknown };
  if (data.error || !data.result) throw new Error("Invalid RPC response");
  return data.result;
}
async function fetchTreasury(): Promise<TreasuryResult> {
  const common = { wallet: TREASURY, chainId: CHAIN_ID, fetchedAt: new Date().toISOString() };
  try {
    const [chain, block] = await Promise.all([rpc("eth_chainId", []), rpc("eth_blockNumber", [])]);
    if (Number(BigInt(chain)) !== CHAIN_ID) throw new Error("Unexpected chain");
    const balance = BigInt(await rpc("eth_getBalance", [TREASURY, block]));
    return { ...common, status: "live", balanceWei: balance.toString(), poolWei: (balance * 55n / 100n).toString(), blockNumber: BigInt(block).toString(), error: null };
  } catch {
    logger.warn("Treasury balance RPC unavailable");
    return { ...common, status: "unavailable", balanceWei: null, poolWei: null, blockNumber: null, error: "The Monad RPC is unavailable. No balance or pool estimate is shown." };
  }
}
export async function getTreasuryBalance(fresh = false) {
  if (fresh) return fetchTreasury();
  if (cached && Date.now() < cached.expires) return cached.result;
  if (!pending) pending = fetchTreasury().then((result) => {
    cached = { result, expires: Date.now() + (result.status === "live" ? 60000 : 15000) };
    return result;
  }).finally(() => { pending = undefined; });
  return pending;
}
