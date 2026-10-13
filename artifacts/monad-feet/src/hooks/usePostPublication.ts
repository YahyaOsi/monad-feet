import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useUser } from "@/context/UserContext";
import { MONAD_MAINNET_CHAIN_ID, MONAD_FEET_CONTRACT_ADDRESS } from "@/lib/contract";
import { useContractActions } from "@/lib/useContractActions";
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const activeWallets = new Set<string>();
class PublicationRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type Draft = { postId: number; contentUri: string; content: string; imageUrl: string; isPaid: boolean; hash?: string };
const keyFor = (wallet: string) => `mf-publication:${MONAD_MAINNET_CHAIN_ID}:${MONAD_FEET_CONTRACT_ADDRESS.toLowerCase()}:${wallet.toLowerCase()}`;
function readDraft(wallet: string): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(keyFor(wallet)) ?? "null");
    return draft && Number.isSafeInteger(draft.postId) && draft.postId > 0 && typeof draft.contentUri === "string" &&
      typeof draft.imageUrl === "string" && (!draft.hash || /^0x[0-9a-fA-F]{64}$/.test(draft.hash)) ? draft : null;
  } catch { return null; }
}
async function request<T>(path: string, wallet: string, data: unknown): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, { method: "POST", credentials: "include", signal: AbortSignal.timeout(90_000),
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet }, body: JSON.stringify(data) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PublicationRequestError(body?.error ?? `Publication failed (HTTP ${response.status}).`, response.status);
  return body as T;
}

/** An owned draft is never a published post. Confirm, verify, then expose it. */
export function usePostPublication() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: MONAD_MAINNET_CHAIN_ID });
  const { createPostOnChain } = useContractActions();
  const wallet = user?.walletAddress ?? "";
  const current = useRef({ wallet, address, chainId });
  current.current = { wallet, address, chainId };
  const locked = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(wallet));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => setDraft(readDraft(wallet));
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("mf-publication-updated", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("mf-publication-updated", refresh); };
  }, [wallet]);
  const save = (owner: string, next: Draft | null) => {
    if (current.current.wallet.toLowerCase() === owner.toLowerCase()) setDraft(next);
    try {
      if (next) localStorage.setItem(keyFor(owner), JSON.stringify(next));
      else localStorage.removeItem(keyFor(owner));
      window.dispatchEvent(new Event("mf-publication-updated"));
    } catch { /* The current draft stays in memory; do not discard a submitted hash. */ }
  };
  async function publish(data?: { content: string; imageUrl: string; isPaid: boolean; legacyPostId?: number }, confirmedHash?: string) {
    if (locked.current || activeWallets.has(wallet.toLowerCase())) throw new Error("Publication is already in progress.");
    const owner = wallet;
    const assertCurrent = () => {
      if (!owner || current.current.wallet.toLowerCase() !== owner.toLowerCase() ||
        current.current.address?.toLowerCase() !== owner.toLowerCase() || current.current.chainId !== MONAD_MAINNET_CHAIN_ID) {
        throw new Error("Use the same signed wallet on Monad Mainnet to resume this publication.");
      }
    };
    assertCurrent();
    locked.current = true; setBusy(true);
    activeWallets.add(owner.toLowerCase());
    try {
      let pending = readDraft(owner) ?? draft;
      if (pending && data?.legacyPostId && pending.postId !== data.legacyPostId) {
        throw new Error("Resume your other pending publication from the Feed first.");
      }
      if (!pending) {
        if (!data) throw new Error("Select an image to prepare a post.");
        pending = await request<Draft>("/posts/prepare", owner, data);
        assertCurrent(); save(owner, pending);
      }
      let hash = confirmedHash?.trim() || pending.hash;
      if (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Enter the full transaction hash from your wallet (0x followed by 64 characters).");
      // A wallet may confirm while the browser is suspended, before its hash
      // reaches localStorage. Never blindly send createPost again on Resume.
      if (!hash || data?.legacyPostId) {
        const recovered = await request<{ anchored: boolean; txHash: string | null }>("/posts/recover", owner, { postId: pending.postId });
        assertCurrent();
        if (recovered.anchored) {
          if (!recovered.txHash) throw new Error("This post is already on Monad. Its original receipt is still needed; no new transaction was requested.");
          hash = recovered.txHash;
          pending = { ...pending, hash }; save(owner, pending);
        }
      }
      if (hash) {
        if (!client) throw new Error("Monad receipt checking is unavailable. Your draft is kept.");
        pending = { ...pending, hash }; save(owner, pending);
        const receipt = await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 60_000,
          onReplaced: ({ transactionReceipt }) => {
            hash = transactionReceipt.transactionHash;
            pending = { ...pending!, hash }; save(owner, pending);
          },
        });
        if (receipt.status !== "success") {
          save(owner, { ...pending, hash: undefined });
          throw new Error("The transaction reverted. Nothing was published. Retry to request a new transaction.");
        }
      } else {
        const original = pending;
        hash = await createPostOnChain(pending.postId, pending.contentUri, submitted => {
          pending = { ...original, hash: submitted }; save(owner, pending);
        }, assertCurrent) ?? undefined;
      }
      if (!hash) throw new Error("A confirmed Monad transaction is required. Nothing was published.");
      assertCurrent();
      const finalize = (txHash: string) => request<{ id: number }>("/posts", owner, {
        postId: pending!.postId, txHash, content: pending!.content, imageUrl: pending!.imageUrl,
        isPaid: pending!.isPaid, authorWalletAddress: owner,
      });
      let post: { id: number };
      try { post = await finalize(hash); }
      catch (error) {
        if (!(error instanceof PublicationRequestError) || error.status !== 422) throw error;
        // Old clients sometimes retained a hash for a different publication.
        // Replace it only with server-verified evidence; never sign on this path.
        const recovered = await request<{ anchored: boolean; txHash: string | null }>("/posts/recover", owner, { postId: pending.postId });
        assertCurrent();
        if (!recovered.anchored || !recovered.txHash) {
          // Chain absence is confirmed, but leave a fresh signature to an
          // explicit retry rather than sending unexpectedly during recovery.
          save(owner, { ...pending, hash: undefined });
          throw new Error("No confirmed publication was found. Your post is saved. Tap Finish publishing to sign it on Monad.");
        }
        if (recovered.txHash.toLowerCase() === hash.toLowerCase()) throw error;
        pending = { ...pending, hash: recovered.txHash }; save(owner, pending);
        post = await finalize(recovered.txHash);
      }
      assertCurrent(); save(owner, null);
      // Recovery can originate from either composer or an old pending card.
      // Refresh all projections, including profile counts and exclusive feeds.
      void queryClient.invalidateQueries();
      return post;
    } catch (error) {
      throw new Error(publicationErrorMessage(error));
    } finally { activeWallets.delete(owner.toLowerCase()); locked.current = false; setBusy(false); }
  }
  async function discard() {
    if (locked.current || activeWallets.has(wallet.toLowerCase())) throw new Error("Close this dialog to keep your draft while confirmation finishes.");
    if (draft?.hash) throw new Error("A submitted transaction must be recovered, not discarded.");
    if (!draft) return;
    const owner = wallet;
    locked.current = true; setBusy(true); activeWallets.add(owner.toLowerCase());
    try {
      const recovered = await request<{ anchored: boolean; txHash: string | null }>("/posts/recover", owner, { postId: draft.postId });
      if (recovered.anchored) {
        save(owner, { ...draft, hash: recovered.txHash ?? undefined });
        throw new Error("This post is already confirmed on Monad. Choose Resume publication to finish without another transaction.");
      }
      save(owner, null);
    } catch (error) { throw new Error(publicationErrorMessage(error)); }
    finally { locked.current = false; setBusy(false); activeWallets.delete(owner.toLowerCase()); }
  }
  return { publish, discard, draft, busy };
}

export function publicationErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "Publication could not finish. Your draft is kept.";
  if (/already anchored/i.test(text)) return "This post is already confirmed on Monad. Resume publication will recover its original receipt, without another payment.";
  if (/user rejected|user denied|request rejected/i.test(text)) return "The wallet request was declined. Your draft is kept; you can close this window or resume later.";
  if (/timeout|timed out|took too long/i.test(text)) return "Confirmation is taking longer than expected. Your draft is safe. Close this window and resume to check the existing transaction.";
  // Raw viem errors contain calldata and long unbroken URLs which can make a
  // mobile dialog wider than the screen. Keep technical details out of the UI.
  return text.split(/\n(?:Contract Call|Request Arguments|Details:|Docs:)/)[0].slice(0, 450);
}
