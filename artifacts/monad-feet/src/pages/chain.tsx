import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Link2, Copy, CheckCircle2, ExternalLink, Users, FileText,
  Zap, Shield, AlertCircle, Terminal, RefreshCw, Globe
} from "lucide-react";
import { CONTRACT_DEPLOYED, MONAD_FEET_CONTRACT_ADDRESS, MONAD_MAINNET_CHAIN_ID } from "@/lib/contract";
import { useContractUserCount, useContractPostCount } from "@/lib/useOnChain";
import { useGetFeedSummary } from "@workspace/api-client-react";

const EXPLORER = "https://explorer.monad.xyz";
const RPC_URL = "https://rpc.monad.xyz";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function StatBox({
  label, chain, db, icon, loading
}: {
  label: string; chain?: string | number; db?: number; icon: React.ReactNode; loading?: boolean
}) {
  return (
    <div className="bg-muted/50 rounded-xl p-4 space-y-1">
      <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
        {icon} {label}
      </div>
      <div className="flex items-end gap-3">
        <div>
          <div className="text-2xl font-bold">
            {loading ? <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /> : (chain ?? "—")}
          </div>
          <div className="text-xs text-violet-600 font-medium">On-chain</div>
        </div>
        {db !== undefined && (
          <div className="pb-0.5">
            <div className="text-sm font-semibold text-muted-foreground">{db}</div>
            <div className="text-xs text-muted-foreground">Database</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChainPage() {
  const { data: userCount, isLoading: usersLoading, refetch: refetchUsers } = useContractUserCount();
  const { data: postCount, isLoading: postsLoading, refetch: refetchPosts } = useContractPostCount();
  const { data: summary } = useGetFeedSummary();

  const handleRefresh = () => {
    refetchUsers();
    refetchPosts();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Link2 className="h-7 w-7 text-violet-600" />
            On-Chain Status
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live data from MonadFeet smart contract on Monad Mainnet
          </p>
        </div>
        {CONTRACT_DEPLOYED && (
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2 flex-shrink-0">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        )}
      </div>

      {/* Contract Status */}
      <Card className={CONTRACT_DEPLOYED
        ? "border-green-200 bg-green-50/50"
        : "border-amber-200 bg-amber-50/50"}>
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            {CONTRACT_DEPLOYED ? (
              <>
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-green-800">Live on Monad Mainnet</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    All user actions are being permanently recorded on-chain.
                  </p>
                </div>
                <Badge className="bg-green-100 text-green-700 border-green-200 flex-shrink-0">
                  Chain ID {MONAD_MAINNET_CHAIN_ID}
                </Badge>
              </>
            ) : (
              <>
                <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-amber-800">Contract Not Deployed</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Actions are saving to the database only. Deploy the contract to go fully on-chain.
                  </p>
                </div>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 flex-shrink-0">
                  Demo Mode
                </Badge>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contract Address */}
      {CONTRACT_DEPLOYED && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-600" /> Contract
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
              <code className="text-sm font-mono flex-1 break-all">{MONAD_FEET_CONTRACT_ADDRESS}</code>
              <CopyButton text={MONAD_FEET_CONTRACT_ADDRESS} />
              <a
                href={`${EXPLORER}/address/${MONAD_FEET_CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-violet-600 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Chain Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" /> Live Stats
          </CardTitle>
          <CardDescription>
            {CONTRACT_DEPLOYED
              ? "Numbers read directly from the smart contract on Monad Mainnet"
              : "Contract not deployed — showing database counts only"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <StatBox
              label="Registered Users"
              chain={CONTRACT_DEPLOYED ? (userCount !== undefined ? Number(userCount).toLocaleString() : undefined) : undefined}
              db={summary?.totalUsers}
              icon={<Users className="h-3.5 w-3.5" />}
              loading={usersLoading}
            />
            <StatBox
              label="Posts Anchored"
              chain={CONTRACT_DEPLOYED ? (postCount !== undefined ? Number(postCount).toLocaleString() : undefined) : undefined}
              db={summary?.totalPosts}
              icon={<FileText className="h-3.5 w-3.5" />}
              loading={postsLoading}
            />
          </div>
        </CardContent>
      </Card>

      {/* Chain Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" /> Monad Mainnet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "Chain ID", value: String(MONAD_MAINNET_CHAIN_ID) },
            { label: "RPC URL", value: RPC_URL },
            { label: "Explorer", value: EXPLORER },
            { label: "Currency", value: "MON" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground font-medium w-24 flex-shrink-0">{label}</span>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono truncate flex-1">{value}</code>
                <CopyButton text={value} />
                {value.startsWith("http") && (
                  <a href={value} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-blue-600 transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Deploy Instructions */}
      {!CONTRACT_DEPLOYED && (
        <Card className="border-dashed border-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Terminal className="h-4 w-4" /> Deploy to Monad Mainnet
            </CardTitle>
            <CardDescription>
              Follow these steps to activate full on-chain functionality
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              {
                step: "1",
                title: "Install Foundry",
                code: "curl -L https://foundry.paradigm.xyz | bash && foundryup",
              },
              {
                step: "2",
                title: "Deploy the contract",
                code: "forge create --rpc-url https://rpc.monad.xyz \\\n  --private-key $PRIVATE_KEY \\\n  contracts/MonadFeet.sol:MonadFeet",
              },
              {
                step: "3",
                title: "Set contract address",
                code: "VITE_CONTRACT_ADDRESS=0xYourDeployedAddress",
                note: "Set this as a secret in your Replit environment variables.",
              },
            ].map(({ step, title, code, note }) => (
              <div key={step} className="flex gap-4">
                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  {step}
                </div>
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-medium">{title}</p>
                  <div className="relative">
                    <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto text-foreground/80">
                      {code}
                    </pre>
                    <div className="absolute top-2 right-2">
                      <CopyButton text={code.replace(/\\\n\s+/g, " ")} />
                    </div>
                  </div>
                  {note && <p className="text-xs text-muted-foreground">{note}</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* On-chain Actions Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contract Functions</CardTitle>
          <CardDescription>Every user action that gets recorded on Monad Mainnet</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { fn: "registerUser(username, inviteCode)", trigger: "Join Monad Feet", gas: "~80k" },
              { fn: "createPost(postId, contentUri)", trigger: "Post to feed", gas: "~60k" },
              { fn: "likePost(postId)", trigger: "Like a post", gas: "~45k" },
              { fn: "subscribe(creator) payable", trigger: "Subscribe to creator", gas: "~50k" },
              { fn: "dailyCheckin()", trigger: "Daily streak check-in", gas: "~35k" },
            ].map(({ fn, trigger, gas }) => (
              <div key={fn} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                <code className="text-xs font-mono bg-violet-50 text-violet-700 px-2 py-1 rounded flex-1 min-w-0 truncate">
                  {fn}
                </code>
                <span className="text-xs text-muted-foreground hidden sm:block w-36 flex-shrink-0">{trigger}</span>
                <span className="text-xs text-muted-foreground font-mono flex-shrink-0">{gas}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
