import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PublicationRecovery({ draft, busy, onDiscard, onError, transactionHash, onTransactionHashChange }: {
  draft: { postId: number; hash?: string } | null;
  busy: boolean;
  onDiscard: () => Promise<void>;
  onError: (message: string) => void;
  transactionHash: string;
  onTransactionHashChange: (hash: string) => void;
}) {
  if (!draft) return null;
  return <div className="min-w-0 rounded-lg bg-muted p-3 text-sm space-y-2">
    <p>Draft #{draft.postId} is saved with its original image and caption. Resume checks for your confirmed transaction before requesting a new one.</p>
    {draft.hash && <p className="break-all font-mono text-xs">Transaction: {draft.hash}</p>}
    {!draft.hash && <Button variant="outline" size="sm" disabled={busy}
      onClick={() => { void onDiscard().catch(error => onError(error instanceof Error ? error.message : "Couldn't check this draft. Please retry.")); }}>
      Discard unsubmitted draft
    </Button>}
    <details>
      <summary className="cursor-pointer text-xs">Use a confirmed transaction hash</summary>
      <label className="mt-2 block text-xs space-y-1">
        <span>Optional: paste the original transaction hash from your wallet, then resume. This does not send another transaction.</span>
        <Input value={transactionHash} onChange={event => onTransactionHashChange(event.target.value)}
          disabled={busy} placeholder="0x…" autoComplete="off" spellCheck={false}
          aria-label="Confirmed publication transaction hash" className="w-full min-w-0 font-mono text-xs" />
      </label>
    </details>
  </div>;
}
