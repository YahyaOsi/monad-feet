import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGame,
  useListGameClaims,
  useClaimGame,
  getGetGameQueryKey,
  getListGameClaimsQueryKey,
  getGetStreakQueryKey,
  getGetLeaderboardQueryKey,
  getGetMyInvitesQueryKey,
  type FeetGameState,
  type FeetGameStateActionsItem,
  type FeetGameAward,
  type FeetGameHistoryClaimsItem,
} from "@workspace/api-client-react";
import { MONAD_FEET_CONTRACT_ADDRESS } from "./contract";

export type GameState = FeetGameState;
export type GameAction = FeetGameStateActionsItem;
export type ClaimResult = FeetGameAward;
export type ClaimRow = FeetGameHistoryClaimsItem;

const scope = (wallet?: string) => wallet?.toLowerCase() ?? "signed-out";

/** Game state scoped to the signed-in wallet so another account's cache never shows. */
export function useGameState(wallet?: string) {
  return useGetGame({
    query: {
      queryKey: [...getGetGameQueryKey(), scope(wallet)],
      enabled: !!wallet,
      refetchInterval: 20_000,
      staleTime: 5_000,
    },
  });
}

export function useGameClaims(wallet?: string) {
  return useListGameClaims({
    query: {
      queryKey: [...getListGameClaimsQueryKey(), scope(wallet)],
      enabled: !!wallet,
      staleTime: 10_000,
    },
  });
}

export function useInvalidateGame() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetGameQueryKey() });
    qc.invalidateQueries({ queryKey: getListGameClaimsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetStreakQueryKey() });
    qc.invalidateQueries({ queryKey: [getGetLeaderboardQueryKey()[0]] });
    qc.invalidateQueries({ queryKey: getGetMyInvitesQueryKey() });
  }, [qc]);
}

export function useClaimGameTx() {
  const invalidate = useInvalidateGame();
  return useClaimGame({ mutation: { onSuccess: () => invalidate() } });
}

export function apiErrorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const d = (e as { data?: unknown }).data;
    if (d && typeof d === "object" && typeof (d as { error?: unknown }).error === "string") {
      return (d as { error: string }).error;
    }
    if (e instanceof Error) return e.message.split("\n")[0];
  }
  return "Request failed";
}

/* ── Local recovery ledger (wallet + contract scoped) ─────────────────────── */

/** submitted = hash known, receipt not verified by us; confirmed = our client saw a successful receipt. */
export type PendingStatus = "submitted" | "confirmed";
export interface PendingTx {
  txHash: string;
  actionName: string;
  status: PendingStatus;
  at: number;
  lastError?: string;
}

function ledgerKey(wallet: string) {
  return `mf_game_pending:${wallet.toLowerCase()}:${MONAD_FEET_CONTRACT_ADDRESS.toLowerCase()}`;
}

function readLedger(wallet: string): PendingTx[] {
  try {
    const raw = localStorage.getItem(ledgerKey(wallet));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function usePendingLedger(wallet?: string) {
  const [items, setItems] = useState<PendingTx[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const itemsRef = useRef<PendingTx[]>([]);
  const itemsWalletRef = useRef(wallet);
  const currentWalletRef = useRef(wallet);
  currentWalletRef.current = wallet;
  useEffect(() => {
    const v = wallet ? readLedger(wallet) : [];
    itemsWalletRef.current = wallet;
    itemsRef.current = v; setItems(v); setStorageError(null);
  }, [wallet]);

  /** Returns false when browser storage failed; in-memory list still updates. */
  const mutate = useCallback((fn: (prev: PendingTx[]) => PendingTx[]): boolean => {
    if (!wallet) return false;
    const base = itemsWalletRef.current === wallet ? itemsRef.current : [];
    const merged = [...readLedger(wallet)];
    for (const b of base) if (!merged.some((m) => m.txHash.toLowerCase() === b.txHash.toLowerCase())) merged.push(b);
    const next = fn(merged);
    const isCurrentWallet = currentWalletRef.current === wallet;
    if (isCurrentWallet) {
      itemsWalletRef.current = wallet;
      itemsRef.current = next;
      setItems(next);
    }
    try {
      localStorage.setItem(ledgerKey(wallet), JSON.stringify(next));
      return true;
    } catch (e) {
      if (isCurrentWallet) setStorageError(e instanceof Error ? e.message : "Browser storage unavailable");
      return false;
    }
  }, [wallet]);

  const upsert = useCallback((tx: PendingTx) => mutate((prev) => [
    tx, ...prev.filter((p) => p.txHash.toLowerCase() !== tx.txHash.toLowerCase()),
  ]), [mutate]);

  const patch = useCallback((hash: string, changes: Partial<PendingTx>) => mutate((prev) =>
    prev.map((p) => p.txHash.toLowerCase() === hash.toLowerCase() ? { ...p, ...changes } : p)), [mutate]);

  const remove = useCallback((hash: string) => mutate((prev) =>
    prev.filter((p) => p.txHash.toLowerCase() !== hash.toLowerCase())), [mutate]);

  return { items, upsert, patch, remove, storageError };
}
