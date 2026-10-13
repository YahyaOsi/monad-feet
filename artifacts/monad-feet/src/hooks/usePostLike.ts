import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getGetPostQueryKey, getListPostsQueryKey } from "@workspace/api-client-react";
import { useUser } from "@/context/UserContext";
import { useContractActions } from "@/lib/useContractActions";
import { useOnChainPostLikeCount, useIsPostLikedOnChain } from "@/lib/useOnChain";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export function usePostLike(post: { id: number; onChainTxHash?: string | null; likeCount?: number } | undefined, promptLogin: () => void, locked = false) {
  const { user } = useUser();
  const { address } = useAccount();
  const currentAddress = useRef(address); currentAddress.current = address;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { likePostOnChain } = useContractActions();
  const id = post?.id ?? 0;
  const count = useOnChainPostLikeCount(id);
  const liked = useIsPostLikedOnChain(id, address);
  const [liking, setLiking] = useState(false);
  const mutex = useRef(false);
  const [confirmed, setConfirmed] = useState<{ id: number; wallet: string; count: number } | null>(null);
  const local = confirmed?.id === id && confirmed.wallet === address?.toLowerCase() ? confirmed : null;
  const isLiked = !!local || liked.data === true;
  const likeCount = local ? Math.max(local.count, Number(count.data ?? 0)) : Number(count.data ?? post?.likeCount ?? 0);
  const usingChainCount = count.data !== undefined;
  async function handleLikeToggle() {
    if (!user) { promptLogin(); return; }
    if (!post?.onChainTxHash || locked || mutex.current) return;
    const wallet = user.walletAddress;
    const assertCurrent = () => {
      if (currentAddress.current?.toLowerCase() !== wallet.toLowerCase()) throw new Error("Wallet changed. Return to the initiating wallet.");
    };
    mutex.current = true; setLiking(true);
    try {
      assertCurrent();
      // The registry has no unlike function. An already-confirmed like can
      // repair a failed app sync without asking for a second wallet transaction.
      const fresh = await liked.refetch();
      let txHash: string | null = null;
      if (fresh.data !== true) txHash = await likePostOnChain(id, undefined, assertCurrent);
      if (!txHash && fresh.data !== true) throw new Error("Like was not confirmed. No off-chain like was saved.");
      assertCurrent();
      setConfirmed({ id, wallet: wallet.toLowerCase(), count: likeCount + (fresh.data === true ? 0 : 1) });
      const response = await fetch(`${BASE}/api/posts/${id}/like`, { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-wallet-address": wallet }, body: JSON.stringify({ txHash }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Chain like confirmed, but app sync failed. Tap the heart to retry; no second transaction is needed.");
      await Promise.all([count.refetch(), liked.refetch()]);
      void queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetPostQueryKey(id) });
      if (fresh.data === true) toast({ title: "Like recorded on Monad", description: "Likes cannot be undone by this contract." });
    } catch (error) {
      toast({ variant: "destructive", title: "Like not completed", description: error instanceof Error ? error.message : "Please retry." });
    } finally { mutex.current = false; setLiking(false); }
  }
  return { isLiked, likeCount, usingChainCount, liking, handleLikeToggle };
}
