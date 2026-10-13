export type RegistrationPreparation = { registered: boolean; txHash: string | null };
export const isRegistrationHash = (value: unknown): value is `0x${string}` =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

export function registrationKey(wallet: string, contract: string, chainId: number) {
  return `mf_registration_${chainId}_${contract.toLowerCase()}_${wallet.toLowerCase()}`;
}

/** Never retry a write after an ambiguous failure. Only a proven revert clears proof. */
export async function recoverRegistration(options: {
  prepare: () => Promise<RegistrationPreparation>;
  savedHash: string | null;
  receipt: (hash: `0x${string}`) => Promise<"success" | "reverted">;
  save: (hash: string | null) => void;
  send: (onSubmitted: (hash: string) => void) => Promise<string | null>;
  assertCurrent: () => void;
}): Promise<string> {
  const prepared = await options.prepare();
  options.assertCurrent();
  if (prepared.registered) {
    if (!isRegistrationHash(prepared.txHash)) {
      throw new Error("Your registration is still syncing. Please try again shortly.");
    }
    options.save(prepared.txHash);
    return prepared.txHash;
  }
  if (isRegistrationHash(options.savedHash)) {
    const status = await options.receipt(options.savedHash);
    options.assertCurrent();
    if (status === "success") return options.savedHash;
    options.save(null);
    // Start a fresh preflight on the next click, never submit two writes in one attempt.
    throw new Error("The previous transaction reverted. Please try joining again.");
  }
  try {
    options.assertCurrent();
    const hash = await options.send((hash) => options.save(hash));
    options.assertCurrent();
    if (!isRegistrationHash(hash)) throw new Error("Onchain registration is unavailable.");
    return hash;
  } catch (error) {
    options.assertCurrent();
    // A competing registration can win between preflight and simulation/mining.
    // Discover its proof; never ask the wallet to sign another transaction here.
    const recovery = await options.prepare();
    options.assertCurrent();
    if (recovery.registered && isRegistrationHash(recovery.txHash)) {
      options.save(recovery.txHash);
      return recovery.txHash;
    }
    throw error;
  }
}

export function registrationError(error: unknown): string {
  const api = error as { data?: { code?: string; error?: string }; status?: number };
  if (api?.data?.code === "USERNAME_TAKEN") return "That username is taken. Please choose another.";
  if (api?.status === 401 || api?.status === 403) return "Please reconnect and sign in with your wallet.";
  if (typeof api?.data?.error === "string" && api.data.error.length < 240 &&
      !/0x[0-9a-f]{40}|viem|request arguments/i.test(api.data.error)) return api.data.error;
  const message = error instanceof Error ? error.message : "";
  if (/reject|denied|cancel/i.test(message)) return "Wallet request cancelled. You can try again.";
  if (/insufficient funds/i.test(message)) return "You need a little MON for the network fee.";
  if (/Switch.*Monad|chain mismatch|chain.*does not match/i.test(message)) return "Switch your wallet to Monad Mainnet and try again.";
  if (/previous transaction reverted|registration is still syncing|registration is unavailable/.test(message)) return message;
  if (/revert/i.test(message)) return "The transaction did not complete. Try again to check its status.";
  return "We couldn’t finish joining. Please try again; any submitted transaction is saved automatically.";
}