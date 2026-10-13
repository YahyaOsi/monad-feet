import { parseAbiItem, zeroAddress } from "viem";
import { gameRpc, InvalidReceiptError } from "./gameChain";
import { REGISTRY } from "./chainConfig";
import { socialAbi, verifySocialReceipt } from "./socialChain";

const createdEvent = parseAbiItem("event PostCreated(address indexed author, uint256 indexed postId, string contentUri, uint256 timestamp)");

/**
 * postAuthor is immutable. Use draft time and retained block headers to locate
 * a bounded log window; archive-capable callers without draft time can locate
 * the first nonzero state. Never infer success merely from the author address.
 * The normal verifier checks the call, commitment, event and canonical block.
 */
export async function recoverPostReceipt(
  id: number, wallet: string, uri: string, client: typeof gameRpc = gameRpc,
  verify: typeof verifySocialReceipt = verifySocialReceipt,
  preparedAt?: Date,
  historicalUri?: string,
  historicalAt?: Date,
): Promise<{ anchored: boolean; txHash: string | null }> {
  // Only the server may supply a legacy URI derived from an owned historical
  // record. Still verify the full original receipt, never just the event.
  const allowedUris = new Set([uri, ...(historicalUri ? [historicalUri] : [])]);
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const authorAt = async (blockNumber: bigint) => {
    try {
      return await client.readContract({
        address: REGISTRY, abi: socialAbi, functionName: "postAuthor",
        args: [BigInt(id)], blockNumber,
      });
    } catch (error) {
      // Calls before contract deployment return no data. RPC/archive failures
      // are NOT evidence that a post is absent.
      const code = await client.getCode({ address: REGISTRY, blockNumber });
      if (!code || code === "0x") return zeroAddress;
      throw error;
    }
  };
  const author = await authorAt(latest);
  if (author === zeroAddress) return { anchored: false, txHash: null };
  if (author.toLowerCase() !== wallet.toLowerCase()) {
    throw new InvalidReceiptError("This post ID belongs to another wallet on Monad. No new transaction was requested.");
  }
  let lo = 0n, hi = latest;
  // The public Monad RPC retains headers/logs but prunes historical state.
  // For app drafts, locate the creation time using headers, then search a
  // bounded nearby log window (RPC permits only 100 blocks per getLogs call).
  if (preparedAt) {
    const windows: [bigint, bigint][] = [];
    const dates = historicalAt && historicalAt.getTime() !== preparedAt.getTime()
      ? [historicalAt, preparedAt] : [preparedAt];
    for (const date of dates) {
      lo = 0n; hi = latest;
      const timestamp = BigInt(Math.max(0, Math.floor(date.getTime() / 1000) - 60));
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        const block = await client.getBlock({ blockNumber: mid });
        if (block.timestamp < timestamp) lo = mid + 1n;
        else hi = mid;
      }
      const end = latest < lo + 4095n ? latest : lo + 4095n;
      windows.push([lo, end]);
    }
    const originalEnd = windows[windows.length - 1][1];
    const recentStart = latest > 4095n ? latest - 4095n : 0n;
    // Wallet confirmation may happen hours after preparation. Also inspect a
    // bounded recent window, without turning recovery into a full-chain scan.
    if (recentStart > originalEnd) windows.push([recentStart, latest]);
    else if (latest > originalEnd) windows.push([originalEnd + 1n, latest]);
    for (const [begin, end] of windows) {
    for (let start = begin; start <= end; start += 400n) {
      const ranges = [0n, 100n, 200n, 300n].map(offset => start + offset).filter(from => from <= end);
      const pages = await Promise.all(ranges.map(from => client.getLogs({
        address: REGISTRY, event: createdEvent,
        args: { author: wallet as `0x${string}`, postId: BigInt(id) },
        fromBlock: from, toBlock: from + 99n < end ? from + 99n : end, strict: true,
      })));
      const events = pages.flat().filter(log => !log.removed && log.transactionHash);
      if (events.length) {
        const matchedUri = events[0].args.contentUri;
        if (events.length !== 1 || !matchedUri || !allowedUris.has(matchedUri)) throw new InvalidReceiptError("The on-chain publication does not match this draft. No new transaction was requested.");
        const txHash = events[0].transactionHash!;
        await verify("post", txHash, wallet, id, matchedUri, client);
        return { anchored: true, txHash };
      }
    }
    }
    throw new Error("Original receipt is outside the automatic recovery windows. Supply the original transaction hash.");
  }
  for (let calls = 0; lo < hi; calls++) {
    if (calls >= 64) throw new Error("Post recovery search limit exceeded.");
    const mid = (lo + hi) / 2n;
    if (await authorAt(mid) === zeroAddress) lo = mid + 1n;
    else hi = mid;
  }
  const logs = await client.getLogs({
    address: REGISTRY, event: createdEvent,
    args: { author: wallet as `0x${string}`, postId: BigInt(id) },
    fromBlock: lo, toBlock: lo, strict: true,
  });
  const matches = logs.filter(log => !log.removed && log.transactionHash && !!log.args.contentUri && allowedUris.has(log.args.contentUri));
  if (matches.length !== 1) {
    throw new InvalidReceiptError("The existing on-chain post does not match this draft. Your original draft is kept; no new transaction was requested.");
  }
  const txHash = matches[0].transactionHash!;
  await verify("post", txHash, wallet, id, matches[0].args.contentUri!, client);
  return { anchored: true, txHash };
}
