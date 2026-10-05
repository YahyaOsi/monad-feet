import { useAccount } from "wagmi";
import { useContractActions } from "./useContractActions";
import { MONAD_FEET_CONTRACT_ADDRESS, MONAD_MAINNET_CHAIN_ID } from "./contract";
import { recoverOrPaySubscription, type SubscriptionQuote } from "./subscriptionRecovery";
import { trackProductEvent } from "./analytics";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function post(path: string, wallet: string, body: unknown) {
  const response = await fetch(`${BASE}/api/subscriptions${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Subscription verification failed");
  return data;
}

export function useSubscriptionPayment() {
  const { address, chainId } = useAccount();
  const { subscribeOnChain } = useContractActions();
  return async (creatorId: number) => {
    const wallet = localStorage.getItem("mf_wallet_address")?.toLowerCase();
    if (!wallet || address?.toLowerCase() !== wallet) throw new Error("Connect your authenticated wallet.");
    const key = `mf_subscription_v1:${wallet}:${creatorId}`;
    // Cross-tab lock plus persisted send-intent prevents duplicate sends on reload.
    if (!navigator.locks) throw new Error("This browser cannot safely coordinate payment recovery.");
    return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error("Subscription payment is already in progress in another tab.");
      const verified = await recoverOrPaySubscription({
        storage: localStorage, key,
        recoverHash: () => window.prompt("A wallet submission may be pending. Do not pay again. Paste its transaction hash from your wallet to recover:"),
        createQuote: async () => {
        if (chainId !== MONAD_MAINNET_CHAIN_ID) throw new Error("Switch to Monad Mainnet.");
        const quote: SubscriptionQuote = await post("/quote", wallet, { creatorId });
        if (quote.subscriberWallet !== wallet || quote.creatorId !== creatorId ||
            quote.chainId !== MONAD_MAINNET_CHAIN_ID ||
            quote.contract.toLowerCase() !== MONAD_FEET_CONTRACT_ADDRESS.toLowerCase() ||
            Date.parse(quote.expiresAt) <= Date.now()) throw new Error("Invalid or expired payment quote.");
        if (!window.confirm(`Subscribe for exactly ${quote.price} MON for 30 days? The quote must be mined before ${new Date(quote.expiresAt).toLocaleTimeString()}. The contract does not enforce listed prices.`)) return null;
        return quote;
        },
        send: (quote, onHash) => subscribeOnChain(quote.creatorWallet, quote.price, onHash),
        verify: (quote, hash) => post("", wallet, { subscriberWalletAddress: wallet, creatorId,
          quoteId: quote.id, txHash: hash }),
      });
      if (verified) trackProductEvent("subscription_verified");
      return verified;
    });
  };
}