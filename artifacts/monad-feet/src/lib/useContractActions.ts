/**
 * useContractActions — central hook for all MonadFeet onchain writes.
 *
 * Confirm a transaction receipt before returning a hash to the DB.
 */
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { parseEther, keccak256 } from "viem";
import {
  MONAD_FEET_CONTRACT_ADDRESS,
  MONAD_FEET_ABI,
  CONTRACT_DEPLOYED,
  MONAD_MAINNET_CHAIN_ID,
  MONAD_TREASURY_ADDRESS,
  EXPECTED_RUNTIME_CODE_HASH,
  GAME_ACTION_IDS,
  GAME_ENABLED,
} from "./contract";

export { CONTRACT_DEPLOYED, GAME_ENABLED };

export function useContractActions() {
  const { writeContractAsync } = useWriteContract();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: MONAD_MAINNET_CHAIN_ID });

  /**
   * Sign and confirm a contract call; fail explicitly on wrong network,
   * missing runtime code, rejection, or reverted receipt.
   */
  async function call(
    functionName: string,
    args: readonly unknown[],
    value?: bigint,
    onSubmitted?: (hash: string) => void,
    assertCurrent?: () => void
  ): Promise<string | null> {
    if (!CONTRACT_DEPLOYED) throw new Error("Monad Feet contract writes are unavailable.");
    if (!address) throw new Error("Connect a wallet before signing.");
    if (chainId !== MONAD_MAINNET_CHAIN_ID) throw new Error("Switch your wallet to Monad Mainnet.");
    if (!publicClient) throw new Error("Monad Mainnet RPC is unavailable.");
    const code = await publicClient.getCode({ address: MONAD_FEET_CONTRACT_ADDRESS });
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== EXPECTED_RUNTIME_CODE_HASH) {
      throw new Error("The platform contract does not match the checked Monad deployment.");
    }
    if (functionName === "playFeetGame" && !GAME_ENABLED) {
      throw new Error("Feet game payments are paused.");
    }
    if (functionName === "playFeetGame" && !(GAME_ACTION_IDS as readonly number[]).includes(Number(args[0]))) {
      throw new Error("Unknown feet game action. No transaction was sent.");
    }
    if (functionName === "subscribe" || functionName === "playFeetGame") {
      const liveTreasury = await publicClient.readContract({
        address: MONAD_FEET_CONTRACT_ADDRESS,
        abi: MONAD_FEET_ABI,
        functionName: "feeRecipient",
      });
      if (liveTreasury.toLowerCase() !== MONAD_TREASURY_ADDRESS.toLowerCase()) {
        throw new Error("The live contract treasury does not match the configured payment wallet. No transaction was sent.");
      }
    }
    // Simulate first so reverts surface before the wallet prompt.
    await publicClient.simulateContract({
      address: MONAD_FEET_CONTRACT_ADDRESS,
      abi: MONAD_FEET_ABI,
      account: address,
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
    } as unknown as Parameters<typeof publicClient.simulateContract>[0]);
    assertCurrent?.();
    const hash = await writeContractAsync({
      address: MONAD_FEET_CONTRACT_ADDRESS,
      abi: MONAD_FEET_ABI,
      chainId: MONAD_MAINNET_CHAIN_ID,
      ...(assertCurrent ? { account: address } : {}),
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
    } as Parameters<typeof writeContractAsync>[0]);
    try { onSubmitted?.(hash); } catch { /* persistence failures are surfaced by the caller */ }
    const receipt = await publicClient.waitForTransactionReceipt({ hash,
      ...(functionName === "createPost" ? {
        timeout: 60_000,
        onReplaced: ({ transactionReceipt }: { transactionReceipt: { transactionHash: `0x${string}` } }) => onSubmitted?.(transactionReceipt.transactionHash),
      } : {}),
    });
    if (receipt.status !== "success") throw new Error(`Monad transaction reverted: ${hash}`);
    return functionName === "createPost" ? receipt.transactionHash : hash;
  }

  return {
    contractDeployed: CONTRACT_DEPLOYED,

    /** Register a new user onchain. Call before saving to DB. */
    registerOnChain: (username: string, inviteCode: string, onSubmitted?: (hash: string) => void, assertCurrent?: () => void) =>
      call("registerUser", [username, inviteCode], undefined, onSubmitted, assertCurrent),

    /** Anchor a DB post onchain. Call after getting postId from DB. */
    createPostOnChain: (postId: number, contentUri: string, onSubmitted?: (hash: string) => void, assertCurrent?: () => void) =>
      call("createPost", [BigInt(postId), contentUri], undefined, onSubmitted, assertCurrent),

    /** Like a post onchain. Call before updating DB. */
    likePostOnChain: (postId: number, onSubmitted?: (hash: string) => void, assertCurrent?: () => void) =>
      call("likePost", [BigInt(postId)], undefined, onSubmitted, assertCurrent),

    /**
     * Subscribe to a creator onchain. The contract forwards MON per the live contract (listed price is NOT enforced onchain).
     * @param creatorAddress Creator's wallet address (0x…)
     * @param priceMonEther  Price as an ether string (e.g. "1.5" for 1.5 MON)
     */
    subscribeOnChain: (creatorAddress: `0x${string}`, priceMonEther: string, onSubmitted?: (hash: string) => void) =>
      call("subscribe", [creatorAddress], parseEther(priceMonEther), onSubmitted),

    /** Daily streak check in onchain. Call before updating DB. */
    dailyCheckinOnChain: (onSubmitted?: (hash: string) => void) =>
      call("dailyCheckin", [], undefined, onSubmitted),

    /**
     * Pay for a feet-care action (1 wash, 2 massage, 3 pedicure). The exact wei
     * value is sent to the contract; onSubmitted fires once a hash exists.
     */
    playFeetGameOnChain: (actionType: number, valueWei: bigint, onSubmitted?: (hash: string) => void) =>
      call("playFeetGame", [actionType], valueWei, onSubmitted),

    /** Anchor a profile update onchain. Call after saving to DB. */
    updateProfileOnChain: (name: string, bio: string, avatarUri: string) =>
      call("updateProfile", [name, bio, avatarUri]),
  };
}
