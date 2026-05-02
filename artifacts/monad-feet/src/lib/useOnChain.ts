/**
 * useOnChain — live read hooks for the MonadFeet smart contract.
 * All hooks are no-ops when the contract is not yet deployed.
 */
import { useReadContract } from "wagmi";
import {
  MONAD_FEET_CONTRACT_ADDRESS,
  MONAD_FEET_ABI,
  CONTRACT_DEPLOYED,
  MONAD_MAINNET_CHAIN_ID,
} from "./contract";

const BASE_OPTS = {
  address: MONAD_FEET_CONTRACT_ADDRESS,
  abi: MONAD_FEET_ABI,
  chainId: MONAD_MAINNET_CHAIN_ID,
} as const;

/** Total registered users on-chain */
export function useContractUserCount() {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "getUserCount",
    query: { enabled: CONTRACT_DEPLOYED, refetchInterval: 30_000 },
  });
}

/** Total posts anchored on-chain */
export function useContractPostCount() {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "getPostCount",
    query: { enabled: CONTRACT_DEPLOYED, refetchInterval: 30_000 },
  });
}

/** Read on-chain UserInfo struct for a wallet address */
export function useOnChainUser(address?: `0x${string}`) {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "users",
    args: address ? [address] : undefined,
    query: { enabled: CONTRACT_DEPLOYED && !!address, refetchInterval: 60_000 },
  });
}

/** On-chain like count for a post (authoritative) */
export function useOnChainPostLikeCount(postId: number) {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "postLikeCount",
    args: [BigInt(postId)],
    query: { enabled: CONTRACT_DEPLOYED, refetchInterval: 30_000 },
  });
}

/** Whether a user has liked a post on-chain */
export function useIsPostLikedOnChain(postId: number, userAddress?: `0x${string}`) {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "isPostLikedBy",
    args: userAddress ? [BigInt(postId), userAddress] : undefined,
    query: { enabled: CONTRACT_DEPLOYED && !!userAddress },
  });
}

/** Whether a subscription is active on-chain */
export function useIsSubscribedOnChain(
  subscriber?: `0x${string}`,
  creator?: `0x${string}`
) {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "isSubscribed",
    args: subscriber && creator ? [subscriber, creator] : undefined,
    query: { enabled: CONTRACT_DEPLOYED && !!subscriber && !!creator, refetchInterval: 60_000 },
  });
}

/** Subscription expiry timestamp (unix seconds) on-chain */
export function useSubscriptionExpiry(
  subscriber?: `0x${string}`,
  creator?: `0x${string}`
) {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "getSubscriptionExpiry",
    args: subscriber && creator ? [subscriber, creator] : undefined,
    query: { enabled: CONTRACT_DEPLOYED && !!subscriber && !!creator },
  });
}

/** Who anchored a post (returns author address or zero address) */
export function useOnChainPostAuthor(postId: number) {
  return useReadContract({
    ...BASE_OPTS,
    functionName: "postAuthor",
    args: [BigInt(postId)],
    query: { enabled: CONTRACT_DEPLOYED },
  });
}
