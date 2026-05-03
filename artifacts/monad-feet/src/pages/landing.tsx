import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { Redirect } from "wouter";
import { Shield, Zap, Users, Link2, ArrowRight } from "lucide-react";
import { CONTRACT_DEPLOYED, MONAD_MAINNET_CHAIN_ID } from "@/lib/contract";
import { useContractUserCount, useContractPostCount } from "@/lib/useOnChain";

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center px-5 py-3 rounded-xl bg-white/60 backdrop-blur-sm border border-border/40 shadow-sm">
      <span className="text-2xl font-bold text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground font-medium mt-0.5">{label}</span>
    </div>
  );
}

const FEATURES = [
  {
    icon: <Link2 className="h-5 w-5 text-violet-600" />,
    bg: "bg-violet-50",
    title: "Fully On-Chain",
    desc: "Every post, like, subscription, and check-in is permanently recorded on Monad Mainnet — immutable proof of every action.",
  },
  {
    icon: <Shield className="h-5 w-5 text-blue-600" />,
    bg: "bg-blue-50",
    title: "Invite Only",
    desc: "Membership is exclusive. Get invited by an existing member or earn invite codes by staying active.",
  },
  {
    icon: <Zap className="h-5 w-5 text-yellow-600" />,
    bg: "bg-yellow-50",
    title: "Earn Streak Points",
    desc: "Check in daily on-chain to build your streak. Points count toward the future $MFEET airdrop.",
  },
  {
    icon: <Users className="h-5 w-5 text-green-600" />,
    bg: "bg-green-50",
    title: "Creator Economy",
    desc: "Creators set a monthly MON price. Subscribers pay directly on-chain — 88% goes to the creator instantly.",
  },
];

export default function Landing() {
  const { isConnected } = useAccount();
  const { user, isLoading } = useUser();
  const { data: chainUsers } = useContractUserCount();
  const { data: chainPosts } = useContractPostCount();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (isConnected && user) return <Redirect to="/feed" />;
  if (isConnected && !user) return <Redirect to="/onboarding" />;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] bg-primary/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-violet-400/8 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[300px] bg-accent/10 rounded-full blur-[100px]" />
      </div>

      <main className="relative z-10 flex flex-col items-center justify-center flex-1 px-4 py-16 text-center">
        {/* Chain status pill */}
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-8 border ${
          CONTRACT_DEPLOYED
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-amber-50 text-amber-700 border-amber-200"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${CONTRACT_DEPLOYED ? "bg-green-500 animate-pulse" : "bg-amber-500"}`} />
          {CONTRACT_DEPLOYED
            ? `Live on Monad Mainnet · Chain ID ${MONAD_MAINNET_CHAIN_ID}`
            : "Deploying to Monad Mainnet"}
        </div>

        {/* Headline */}
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground leading-tight max-w-2xl">
          Monad{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-primary">
            Feet
          </span>
        </h1>
        <p className="mt-4 text-xl text-muted-foreground font-light max-w-md">
          The invite-only Web3 social club — fully on-chain on Monad Mainnet.
        </p>

        {/* Live chain stats */}
        {CONTRACT_DEPLOYED && (chainUsers !== undefined || chainPosts !== undefined) && (
          <div className="flex gap-3 mt-8">
            {chainUsers !== undefined && (
              <StatPill value={Number(chainUsers).toLocaleString()} label="Members on-chain" />
            )}
            {chainPosts !== undefined && (
              <StatPill value={Number(chainPosts).toLocaleString()} label="Posts anchored" />
            )}
          </div>
        )}

        {/* Connect button */}
        <div className="mt-10">
          <appkit-button />
        </div>
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
          <Shield className="h-3 w-3" /> Invite code required to join
        </p>

        {/* Feature grid */}
        <div className="grid sm:grid-cols-2 gap-4 mt-16 max-w-2xl w-full text-left">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm p-5 space-y-2 hover:border-primary/30 hover:shadow-sm transition-all"
            >
              <div className={`w-9 h-9 rounded-lg ${f.bg} flex items-center justify-center`}>
                {f.icon}
              </div>
              <h3 className="font-semibold text-sm">{f.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="mt-16 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Already a member? Connect your wallet above to sign in.
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Link2 className="h-3 w-3" />
            Monad Testnet · Chain {MONAD_MAINNET_CHAIN_ID}
            <a
              href="https://testnet.monadexplorer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground transition-colors flex items-center gap-0.5 ml-1"
            >
              monadexplorer.com <ArrowRight className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
