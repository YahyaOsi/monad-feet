/**
 * useContractActions — central hook for all MonadFeet on-chain writes.
 *
 * Every action goes to Monad Mainnet first (if the contract is deployed),
 * then the DB is updated as a performance cache. If the contract is not yet
 * deployed (VITE_CONTRACT_ADDRESS not set), actions fall through to DB-only.
 */
import { useWriteContract } from "wagmi";
import { parseEther } from "viem";
import {
  MONAD_FEET_CONTRACT_ADDRESS,
  MONAD_FEET_ABI,
  CONTRACT_DEPLOYED,
} from "./contract";

export { CONTRACT_DEPLOYED };

export function useContractActions() {
  const { writeContractAsync } = useWriteContract();

  /**
   * Sign + broadcast a contract call. Returns txHash or null if contract not deployed.
   * Throws if the user rejects or the tx fails.
   */
  async function call(
    functionName: string,
    args: readonly unknown[],
    value?: bigint
  ): Promise<string | null> {
    if (!CONTRACT_DEPLOYED) return null;
    return writeContractAsync({
      address: MONAD_FEET_CONTRACT_ADDRESS,
      abi: MONAD_FEET_ABI,
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
    } as Parameters<typeof writeContractAsync>[0]);
  }

  return {
    contractDeployed: CONTRACT_DEPLOYED,

    /** Register a new user on-chain. Call before saving to DB. */
    registerOnChain: (username: string, inviteCode: string) =>
      call("registerUser", [username, inviteCode]),

    /** Anchor a DB post on-chain. Call after getting postId from DB. */
    createPostOnChain: (postId: number, contentUri: string) =>
      call("createPost", [BigInt(postId), contentUri]),

    /** Like a post on-chain. Call before updating DB. */
    likePostOnChain: (postId: number) =>
      call("likePost", [BigInt(postId)]),

    /**
     * Subscribe to a creator on-chain. The contract splits MON 88/12 automatically.
     * @param creatorAddress Creator's wallet address (0x…)
     * @param priceMonEther  Price as an ether string (e.g. "1.5" for 1.5 MON)
     */
    subscribeOnChain: (creatorAddress: `0x${string}`, priceMonEther: string) =>
      call("subscribe", [creatorAddress], parseEther(priceMonEther)),

    /** Daily streak check-in on-chain. Call before updating DB. */
    dailyCheckinOnChain: () => call("dailyCheckin", []),
  };
}
