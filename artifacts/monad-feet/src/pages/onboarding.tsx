import { useEffect, useRef, useState } from "react";
import { Redirect } from "wouter";
import { useValidateInviteCode, useRegisterUser } from "@workspace/api-client-react";
import { useUser } from "@/context/UserContext";
import { useAccount, usePublicClient } from "wagmi";
import { customFetch } from "../../../../lib/api-client-react/src/custom-fetch";
import { MONAD_FEET_CONTRACT_ADDRESS, MONAD_MAINNET_CHAIN_ID } from "@/lib/contract";
import { isRegistrationHash, recoverRegistration, registrationError, registrationKey, type RegistrationPreparation } from "@/lib/registrationRecovery";
import { useContractActions } from "@/lib/useContractActions";
import { postLoginPath } from "@/lib/shareNavigation";
import { trackProductEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Loader2, Link2, CheckCircle2 } from "lucide-react";


type Step = 1 | 2;
type TxState = "idle" | "signing" | "confirmed";

export default function Onboarding() {
  const [step, setStep] = useState<Step>(1);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [regError, setRegError] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [recoveryHash, setRecoveryHash] = useState("");
  const [pending, setPending] = useState(false);
  const [chogHolder, setChogHolder] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);

  const { isConnected, address } = useAccount();
  const { user, isLoading, session } = useUser();
  const publicClient = usePublicClient({ chainId: MONAD_MAINNET_CHAIN_ID });
  const identity = isConnected ? address?.toLowerCase() : undefined;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const validateInvite = useValidateInviteCode();
  const register = useRegisterUser();
  const { contractDeployed, registerOnChain } = useContractActions();

  const recoveryKey = registrationKey(identity ?? "", MONAD_FEET_CONTRACT_ADDRESS, MONAD_MAINNET_CHAIN_ID);
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setPending(false);
    setRegError("");
    setInviteError("");
    setRecoveryHash("");
    setInviteCode("");
    setChogHolder(false);
    setUsername("");
    setName("");
    setBio("");
    setStep(1);
    setTxState("idle");
    try {
      const saved = JSON.parse(localStorage.getItem(recoveryKey) || "null");
      // Legacy wallet-only keys are deliberately not trusted across deployments.
      if (identity && saved && isRegistrationHash(saved.hash)) {
        setRecoveryHash(saved.hash);
        setInviteCode(typeof saved.inviteCode === "string" ? saved.inviteCode : "");
        setUsername(typeof saved.username === "string" ? saved.username : "");
        setName(typeof saved.name === "string" ? saved.name : "");
        setBio(typeof saved.bio === "string" ? saved.bio : "");
        setStep(2);
      }
    } catch { /* Server preflight can rediscover confirmed registrations. */ }
    return () => { generation.current++; };
  }, [recoveryKey, identity]);

  if (isLoading) return <div className="min-h-[100dvh] flex items-center justify-center text-muted-foreground" role="status">Loading...</div>;
  if (!isConnected) return <Redirect to="/" />;
  if (user) return <Redirect to={postLoginPath(window.location.search) ?? "/feed"} />;

  const handleCheckNft = async () => {
    if (busy.current || !address || session.phase !== "verified") return;
    busy.current = true; setPending(true); setInviteError("");
    const id = generation.current;
    try {
      const result = await customFetch<{ chogHolder: boolean }>("/api/auth/nft-access", {
        method: "GET", credentials: "include", responseType: "json", headers: { "x-wallet-address": address },
      });
      if (id !== generation.current) return;
      setChogHolder(result.chogHolder);
      if (result.chogHolder) { setInviteCode(""); setStep(2); }
      else setInviteError("No CHOG Genesis NFT was found in this wallet. Use an invite code or hold the NFT and retry.");
    } catch (error) {
      if (id === generation.current) setInviteError(registrationError(error));
    } finally { if (id === generation.current) { busy.current = false; setPending(false); } }
  };

  const handleValidate = async () => {
    if (!inviteCode.trim() || busy.current) return;
    busy.current = true;
    setPending(true);
    const id = generation.current;
    const isCurrent = () => id === generation.current && identity === currentIdentity.current;
    setInviteError("");
    try {
      const res = await validateInvite.mutateAsync({ data: { code: inviteCode.trim() } });
      if (!isCurrent()) return;
      if (res.valid) {
        setStep(2);
      } else {
        setInviteError(res.message ?? "Invalid invite code");
      }
    } catch (e: unknown) {
      if (isCurrent()) setInviteError(registrationError(e));
    } finally {
      if (isCurrent()) { busy.current = false; setPending(false); }
    }
  };

  const handleRegister = async () => {
    if (busy.current || !name.trim() || !/^[a-z0-9_]{3,32}$/.test(username.trim()) ||
        !address || (!inviteCode.trim() && !chogHolder && !recoveryHash) || session.phase !== "verified") return;
    busy.current = true;
    setPending(true);
    const id = generation.current;
    const isCurrent = () => id === generation.current && identity === currentIdentity.current;
    const assertCurrent = () => { if (!isCurrent()) throw new Error("Wallet changed"); };
    const profile = { inviteCode: inviteCode.trim(), username: username.trim(), name: name.trim(), bio: bio.trim() };
    const save = (hash: string | null) => {
      // A late wallet result belongs to the initiating wallet, not the current one.
      try {
        if (hash) localStorage.setItem(recoveryKey, JSON.stringify({ ...profile, hash }));
        else localStorage.removeItem(recoveryKey);
      } catch { /* Keep in-memory proof if browser storage is unavailable. */ }
      if (isCurrent()) setRecoveryHash(hash ?? "");
    };
    setRegError("");
    setTxState("signing");
    try {
      const txHash = await recoverRegistration({
        prepare: () => {
          assertCurrent();
          return customFetch<RegistrationPreparation>("/api/auth/registration/prepare", {
            method: "POST", credentials: "include", responseType: "json",
            headers: { "x-wallet-address": address },
            body: JSON.stringify({ username: profile.username, inviteCode: profile.inviteCode }),
          });
        },
        savedHash: recoveryHash || null,
        receipt: async (hash) => {
          if (!publicClient) throw new Error("Network unavailable");
          return (await publicClient.waitForTransactionReceipt({ hash })).status;
        },
        save,
        send: (onSubmitted) => registerOnChain(profile.username, profile.inviteCode, onSubmitted, assertCurrent),
        assertCurrent,
      });
      assertCurrent();
      setTxState("confirmed");
      await register.mutateAsync({
        data: {
          walletAddress: address,
          ...profile,
          bio: profile.bio || undefined,
          txHash,
        },
      });
      assertCurrent();
      trackProductEvent("signup_completed");
      try { localStorage.removeItem(recoveryKey); } catch { /* Profile is already saved. */ }
      const returnTo = postLoginPath(window.location.search);
      window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, "")}${returnTo ?? "/feed"}`);
    } catch (e: unknown) {
      if (isCurrent()) { setRegError(registrationError(e)); setTxState("idle"); }
    } finally {
      if (isCurrent()) { busy.current = false; setPending(false); }
    }
  };

  const isRegistering = pending;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4 gap-4">
      <div className="w-full max-w-md flex justify-end"><ThemeToggle /></div>
      <Card className="w-full max-w-md shadow-xl shadow-primary/5 border-border rounded-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to Monad Feet</CardTitle>
          <CardDescription>
            {step === 1 ? "Enter the invite code you got from the team." : "Set up your profile."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={pending} className="min-w-0">
          {step === 1 ? (
            <div className="space-y-4">
              <>
                  <div className="space-y-2">
                    <Label htmlFor="invite">Invite Code</Label>
                    <Input
                      id="invite"
                      placeholder="e.g. MONAD00001"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleValidate()}
                      className="text-center text-lg tracking-widest uppercase"
                    />
                    {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleValidate}
                    disabled={!inviteCode.trim() || validateInvite.isPending}
                  >
                    {validateInvite.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying...</>
                    ) : "Verify Code"}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Join with an unused invite or a CHOG Genesis NFT in your wallet. Monad Feet NFT admission is not available yet; its mint is coming soon.
                  </p>
                  <Button variant="outline" className="w-full" onClick={() => void handleCheckNft()} disabled={pending || session.phase !== "verified"}>
                    {pending ? "Checking ownership…" : "Join with CHOG NFT"}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">CHOG access is checked on Monad Mainnet. NFT-admitted accounts need to keep a CHOG NFT in this wallet. Registration still requires a network transaction and gas.</p>
                  <a className="text-xs text-primary underline text-center block" href="https://opensea.io/collection/chog-genesis" target="_blank" rel="noopener noreferrer">View CHOG Genesis collection</a>
                </>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Satoshi Nakamoto"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-muted-foreground">@</span>
                  <Input
                    id="username"
                    className="pl-8"
                    value={username}
                    maxLength={32}
                    minLength={3}
                    onChange={(e) => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")); setRegError(""); }}
                    placeholder="satoshi"
                  />
                </div>
                <p className="text-xs text-muted-foreground">3 to 32 letters, numbers or underscores.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">Bio <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A line about you"
                  className="resize-none"
                />
              </div>

              {/* Onchain status indicator */}
              {contractDeployed && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40 px-4 py-3 flex items-start gap-3">
                  {txState === "idle" && (
                    <>
                      <Link2 className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-violet-700 dark:text-violet-300">
                        Joining takes two steps: sign a transaction, then create your profile.
                      </p>
                    </>
                  )}
                  {txState === "signing" && (
                    <>
                      <Loader2 className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0 animate-spin" />
                      <p className="text-xs text-violet-700 dark:text-violet-300">
                        Checking registration. Confirm in your wallet if asked...
                      </p>
                    </>
                  )}
                  {txState === "confirmed" && (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-green-700 dark:text-green-300">
                        Verifying registration and creating your profile...
                      </p>
                    </>
                  )}
                </div>
              )}

              {regError && <p role="alert" className="text-sm text-destructive">{regError}</p>}

              <Button
                className="w-full"
                onClick={handleRegister}
                disabled={!name.trim() || !/^[a-z0-9_]{3,32}$/.test(username.trim()) || (!inviteCode.trim() && !chogHolder && !recoveryHash) || isRegistering || session.phase !== "verified"}
              >
                {isRegistering ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Joining...
                  </>
                ) : recoveryHash.trim() ? "Continue joining" : "Sign and join"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={isRegistering}
                onClick={() => { setRegError(""); setInviteError(""); setStep(1); }}
              >
                Change invite code
              </Button>
            </div>
          )}
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
