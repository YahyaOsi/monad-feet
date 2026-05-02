import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import {
  Home, Lock, Wallet, Trophy, User as UserIcon,
  Settings, LogOut, Bell, Link2, X, Compass, Flame
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { usePresence, useTrendingAlert, useBadgeAlert } from "@/hooks/usePresence";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useUser();
  const { isConnected: walletConnected } = useAccount();
  const [unreadCount, setUnreadCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const { onlineCount } = usePresence();
  const { alert: trendingAlert, dismiss: dismissTrending } = useTrendingAlert();
  const { alert: badgeAlert, dismiss: dismissBadge } = useBadgeAlert();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;
    const fetchCount = () => {
      const wallet = localStorage.getItem("mf_wallet_address") ?? "";
      fetch(`${BASE}/api/notifications`, { headers: { "x-wallet-address": wallet } })
        .then((r) => r.json())
        .then((d) => setUnreadCount((d as { unreadCount?: number }).unreadCount ?? 0))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [user]);

  // Show a toast when one of the user's posts enters the top 3 on Trending
  useEffect(() => {
    if (!trendingAlert) return;
    const rankEmoji = trendingAlert.rank === 1 ? "🥇" : trendingAlert.rank === 2 ? "🥈" : "🥉";
    const caption = trendingAlert.postContent
      ? `"${trendingAlert.postContent.slice(0, 48)}${trendingAlert.postContent.length > 48 ? "…" : ""}"`
      : "Your post";
    toast({
      title: `${rankEmoji} You're #${trendingAlert.rank} on Trending!`,
      description: `${caption} just entered the top 3.`,
      duration: 8_000,
    });
    dismissTrending();
  }, [trendingAlert?.postId, trendingAlert?.seenAt]);

  // Show a toast when the user earns a milestone badge
  useEffect(() => {
    if (!badgeAlert) return;
    toast({
      title: `${badgeAlert.badge.emoji} Badge earned: ${badgeAlert.badge.label}`,
      description: badgeAlert.badge.description,
      duration: 8_000,
    });
    dismissBadge();
  }, [badgeAlert?.badge.badgeType, badgeAlert?.seenAt]);

  const navItems = [
    { label: "Feed", href: "/feed", icon: Home },
    { label: "Trending", href: "/trending", icon: Flame },
    {
      label: "Discover",
      href: "/discover",
      icon: Compass,
      badge: onlineCount > 0 ? onlineCount : 0,
      badgeVariant: "green" as const,
    },
    { label: "Private", href: "/private", icon: Lock },
    { label: "Wallet", href: "/wallet", icon: Wallet },
    { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
    { label: "Profile", href: `/profile/${user?.id ?? ""}`, icon: UserIcon },
    { label: "Notifications", href: "/notifications", icon: Bell, badge: unreadCount, badgeVariant: "red" as const },
    { label: "Chain", href: "/chain", icon: Link2 },
    { label: "Settings", href: "/settings", icon: Settings },
  ];

  if (!walletConnected || !user) return <>{children}</>;

  const showBanner = !CONTRACT_DEPLOYED && !bannerDismissed;

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar hidden md:flex flex-col justify-between fixed top-0 bottom-0 left-0 h-screen">
        <div>
          <div className="p-6 pb-4">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-primary">Monad Feet</h1>
              {CONTRACT_DEPLOYED ? (
                <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                  <span className="h-1 w-1 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                  Demo
                </span>
              )}
            </div>
            <p className="text-sm text-sidebar-foreground/70">Exclusive Web3 Club</p>
            {onlineCount > 0 && (
              <p className="text-xs text-green-600 font-medium mt-1 flex items-center gap-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                </span>
                {onlineCount} online now
              </p>
            )}
          </div>
          <nav className="px-4 space-y-0.5">
            {navItems.map((item) => {
              const isActive =
                location === item.href || location.startsWith(item.href + "/");
              const Icon = item.icon;
              const badgeCount = item.badge ?? 0;
              const isGreenBadge = item.badgeVariant === "green";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <div className="relative">
                    <Icon className="h-5 w-5" />
                    {badgeCount > 0 && (
                      <span className={`absolute -top-1.5 -right-1.5 h-4 w-4 text-white text-[10px] font-bold rounded-full flex items-center justify-center ${
                        isGreenBadge ? "bg-green-500" : "bg-destructive"
                      }`}>
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </div>
                  {item.label}
                  {item.href === "/chain" && (
                    <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      CONTRACT_DEPLOYED ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {CONTRACT_DEPLOYED ? "Live" : "Demo"}
                    </span>
                  )}
                  {item.href === "/discover" && onlineCount > 0 && !isActive && (
                    <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                      {onlineCount} online
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-4 border-t border-sidebar-border">
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={logout}
          >
            <LogOut className="h-5 w-5 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-64 w-full">
        {showBanner && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-amber-800">
              <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
              <span>
                <strong>Deploy mode:</strong> Smart contract not deployed — actions save to database only.
                Deploy <code className="bg-amber-100 px-1 rounded">contracts/MonadFeet.sol</code> and set{" "}
                <code className="bg-amber-100 px-1 rounded">VITE_CONTRACT_ADDRESS</code> to go fully on-chain.
                <Link href="/chain" className="ml-2 underline hover:text-amber-900">
                  View instructions →
                </Link>
              </span>
            </div>
            <button onClick={() => setBannerDismissed(true)} className="flex-shrink-0 text-amber-500 hover:text-amber-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="p-4 md:p-8 max-w-4xl mx-auto">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background border-border flex justify-around p-2 z-50">
        {navItems.filter((i) => !["Settings", "Chain"].includes(i.label)).map((item) => {
          const isActive = location === item.href || location.startsWith(item.href + "/");
          const Icon = item.icon;
          const badgeCount = item.badge ?? 0;
          const isGreenBadge = item.badgeVariant === "green";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`p-2 rounded-md relative ${isActive ? "text-primary" : "text-muted-foreground"}`}
            >
              <Icon className="h-6 w-6" />
              {badgeCount > 0 && (
                <span className={`absolute top-1 right-1 h-3.5 w-3.5 text-white text-[9px] font-bold rounded-full flex items-center justify-center ${
                  isGreenBadge ? "bg-green-500" : "bg-destructive"
                }`}>
                  {badgeCount > 9 ? "9+" : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
