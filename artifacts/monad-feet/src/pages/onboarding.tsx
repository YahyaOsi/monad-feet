import { useState, useEffect } from "react";
import { Redirect } from "wouter";
import { useValidateInviteCode, useRegisterUser } from "@workspace/api-client-react";
import { useUser } from "@/context/UserContext";
import { useAccount, useReadContract } from "wagmi";
import { useContractActions } from "@/lib/useContractActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Link2, CheckCircle2, Gem } from "lucide-react";

const NFT_CONTRACT = "0x656b1011a20b826f7c4ce1a07e5f350a52a3711d" as const;
const ERC721_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "owner", type: "address" as const }],
    outputs: [{ name: "", type: "uint256" as const }],
  },
] as const;

type Step = 1 | 2;
type TxState = "idle" | "signing" | "confirmed" | "skipped";

export default function Onboarding() {
  const [step, setStep] = useState<Step>(1);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [regError, setRegError] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");

  const { isConnected, address } = useAccount();
  const { user, isLoading } = useUser();
  const validateInvite = useValidateInviteCode();
  const register = useRegisterUser();
  const { contractDeployed, registerOnChain } = useContractActions();

  // Check if wallet holds the Monad Feet NFT
  const { data: nftBalance, isLoading: nftLoading } = useReadContract({
    address: NFT_CONTRACT,
    abi: ERC721_BALANCE_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: 143,
    query: { enabled: !!address },
  });
  const hasNft = nftBalance !== undefined && nftBalance > 0n;

  // Auto-advance past the invite step if NFT detected
  useEffect(() => {
    if (hasNft && step === 1) setStep(2);
  }, [hasNft]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!isConnected) return <Redirect to="/" />;
  if (user) return <Redirect to="/feed" />;

  const handleValidate = async () => {
    if (!inviteCode.trim()) return;
    setInviteError("");
    try {
      const res = await validateInvite.mutateAsync({ data: { code: inviteCode } });
      if (res.valid) {
        setStep(2);
      } else {
        setInviteError(res.message ?? "Invalid invite code");
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setInviteError(err.response?.data?.error ?? "Invalid invite code");
    }
  };

  const handleRegister = async () => {
    if (!name.trim() || !username.trim() || !address) return;
    setRegError("");

    let txHash: string | null = null;

    // Step 1: Sign the on-chain registerUser() transaction on Monad Mainnet
    if (contractDeployed) {
      setTxState("signing");
      try {
        txHash = await registerOnChain(username.trim(), inviteCode);
        setTxState("confirmed");
      } catch {
        // User declined or tx failed — continue with DB-only registration
        setTxState("skipped");
      }
    }

    // Step 2: Save to DB (with optional on-chain proof)
    try {
      await register.mutateAsync({
        data: {
          walletAddress: address,
          inviteCode: inviteCode || undefined,
          name: name.trim(),
          username: username.trim(),
          bio: bio.trim() || undefined,
          avatarUrl: avatarUrl.trim() || undefined,
          txHash: txHash ?? undefined,
        },
      });
      window.location.href = "/feed";
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setRegError(err.response?.data?.error ?? "Registration failed. Please try again.");
      setTxState("idle");
    }
  };

  const isRegistering = register.isPending || txState === "signing";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to Monad Feet</CardTitle>
          <CardDescription>
            {step === 1
              ? nftLoading
                ? "Checking your wallet for NFT access..."
                : "Enter your invite code or hold the Monad Feet NFT to join."
              : hasNft
              ? "NFT access granted — set up your profile to join."
              : "Set up your profile to join."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 1 ? (
            <div className="space-y-4">
              {/* NFT check loading state */}
              {nftLoading && (
                <div className="flex items-center justify-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-4">
                  <Loader2 className="h-4 w-4 text-violet-600 animate-spin flex-shrink-0" />
                  <p className="text-sm text-violet-700">Checking for Monad Feet NFT in your wallet...</p>
                </div>
              )}
              {!nftLoading && (
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
                    — or hold the{" "}
                    <a
                      href="https://monvision.io/address/0x656b1011a20b826f7c4ce1a07e5f350a52a3711d"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-600 hover:underline"
                    >
                      Monad Feet NFT
                    </a>
                    {" "}to join without a code —
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* NFT access badge */}
              {hasNft && (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <Gem className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-700">Monad Feet NFT detected</p>
                    <p className="text-xs text-emerald-600">No invite code needed — your NFT grants you access.</p>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
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
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="satoshi"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="avatar">Avatar URL (optional)</Label>
                <Input
                  id="avatar"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">Bio (optional)</Label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Building the future of finance..."
                  className="resize-none"
                />
              </div>

              {/* On-chain status indicator */}
              {contractDeployed && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 flex items-start gap-3">
                  {txState === "idle" && (
                    <>
                      <Link2 className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-violet-700">
                        Joining will require <strong>two steps</strong>: sign a transaction on{" "}
                        <strong>Monad Mainnet</strong>, then create your profile.
                      </p>
                    </>
                  )}
                  {txState === "signing" && (
                    <>
                      <Loader2 className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0 animate-spin" />
                      <p className="text-xs text-violet-700">
                        Sign the transaction in your wallet to register on Monad...
                      </p>
                    </>
                  )}
                  {txState === "confirmed" && (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-green-700">
                        Transaction confirmed! Creating your profile...
                      </p>
                    </>
                  )}
                  {txState === "skipped" && (
                    <>
                      <Link2 className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-orange-700">
                        On-chain tx skipped — registering off-chain only.
                      </p>
                    </>
                  )}
                </div>
              )}

              {regError && <p className="text-sm text-destructive">{regError}</p>}

              <Button
                className="w-full"
                onClick={handleRegister}
                disabled={!name.trim() || !username.trim() || isRegistering}
              >
                {isRegistering ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {txState === "signing" ? "Sign on Monad..." : "Joining..."}
                  </>
                ) : contractDeployed ? "Sign & Join Monad Feet" : "Join Monad Feet"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
