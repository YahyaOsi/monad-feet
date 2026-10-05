export type SubscriptionQuote = { id: string; subscriberWallet: string; creatorId: number; creatorWallet: `0x${string}`;
  price: string; chainId: number; contract: string; expiresAt: string };
type Pending = { quote: SubscriptionQuote; hash?: string; submitting?: boolean };

/** Caller holds a cross-tab lock for this authenticated wallet/creator key. */
export async function recoverOrPaySubscription(options: {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  key: string;
  createQuote: () => Promise<SubscriptionQuote | null>;
  recoverHash: () => string | null;
  send: (quote: SubscriptionQuote, onHash: (hash: string) => void) => Promise<unknown>;
  verify: (quote: SubscriptionQuote, hash: string) => Promise<unknown>;
}) {
  const { storage, key } = options;
  let pending: Pending | null = JSON.parse(storage.getItem(key) ?? "null");
  if (pending?.submitting && !pending.hash) {
    const hash = options.recoverHash();
    if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error("Recovery requires the transaction hash from your wallet. No second payment was sent.");
    }
    pending = { quote: pending.quote, hash };
    storage.setItem(key, JSON.stringify(pending));
  }
  if (!pending?.hash) {
    const quote = await options.createQuote();
    if (!quote) return false;
    pending = { quote, submitting: true };
    // Durable intent must succeed BEFORE a wallet write.
    storage.setItem(key, JSON.stringify(pending));
    try {
      await options.send(quote, (hash) => {
        pending = { quote, hash };
        storage.setItem(key, JSON.stringify(pending));
      });
    } catch (error) {
      if (!pending?.hash && /user rejected|user denied/i.test((error as Error).message)) storage.removeItem(key);
      throw error;
    }
  }
  if (!pending?.hash) throw new Error("Payment hash unavailable; do not send another payment.");
  await options.verify(pending.quote, pending.hash);
  storage.removeItem(key);
  return true;
}