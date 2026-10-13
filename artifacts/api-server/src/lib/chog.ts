import { parseAbi, isAddress } from "viem";
import { gameRpc } from "./gameChain";
import { CHAIN_ID } from "./chainConfig";

export const CHOG_COLLECTION = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763" as const;
const abi = parseAbi(["function supportsInterface(bytes4) view returns(bool)", "function balanceOf(address) view returns(uint256)"]);
const balances = new Map<string, { holder: boolean; until: number }>();
export async function hasChogNft(wallet: string, fresh = false): Promise<boolean> {
  if (!isAddress(wallet)) return false;
  const key = wallet.toLowerCase();
  const cached = balances.get(key);
  if (!fresh && cached && cached.until > Date.now()) return cached.holder;
  if (await gameRpc.getChainId() !== CHAIN_ID) throw new Error("Wrong NFT network");
  const code = await gameRpc.getCode({ address: CHOG_COLLECTION });
  if (!code || code === "0x" || !await gameRpc.readContract({ address: CHOG_COLLECTION, abi,
    functionName: "supportsInterface", args: ["0x80ac58cd"] })) throw new Error("CHOG collection unavailable");
  const balance = await gameRpc.readContract({ address: CHOG_COLLECTION, abi, functionName: "balanceOf", args: [wallet as `0x${string}`] });
  const holder = balance > 0n;
  if (balances.size > 10_000) balances.clear();
  balances.set(key, { holder, until: Date.now() + 30_000 });
  return holder;
}
