import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useUser } from "@/context/UserContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { onboardingPath, safeShareReturnPath } from "@/lib/shareNavigation";

export function useShareLoginPrompt() {
  const [location, navigate] = useLocation();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { user, isLoading, isError, session, signIn, retrySession } = useUser();
  const [open, setOpen] = useState(false);
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !isConnected || session.phase !== "verified" || isLoading || isError) return;
    if (user) {
      setOpen(false);
      returnTo.current = null;
      return;
    }
    setOpen(false);
    navigate(onboardingPath(returnTo.current ?? safeShareReturnPath(location)));
    returnTo.current = null;
  }, [open, isConnected, session.phase, isLoading, isError, user, navigate, location]);

  const promptLogin = () => {
    if (user) return;
    returnTo.current = safeShareReturnPath(location);
    setOpen(true);
  };

  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) returnTo.current = null;
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to continue</DialogTitle>
          <DialogDescription>
            Connect and sign in to interact. You can keep viewing this shared page; no action or wallet signature happens until you choose to sign in.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-col">
          {!isConnected ? (
            <Button onClick={() => openConnectModal?.()} disabled={!openConnectModal} data-testid="button-connect-to-sign-in">
              Connect wallet
            </Button>
          ) : (
            <Button
              onClick={() => void signIn()}
              disabled={session.phase === "checking" || session.phase === "signing" || session.phase === "verified"}
              data-testid="button-sign-in-to-continue"
            >
              {session.phase === "signing" ? "Waiting for wallet…" : session.phase === "error" ? "Retry sign in" : "Sign in"}
            </Button>
          )}
          {session.error && <p role="alert" className="text-sm text-destructive">{session.error}</p>}
          {session.phase === "error" && (
            <Button variant="outline" onClick={retrySession}>Retry wallet session check</Button>
          )}
          {isError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">Could not load your account profile. Retry before continuing.</p>
              <Button variant="outline" onClick={retrySession}>Retry account check</Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { promptLogin, dialog };
}