import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ToastAction } from "@/components/ui/toast";
import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import {
  Home, Lock, Wallet, Trophy, User as UserIcon,
  Settings, LogOut, Bell, Link2, X, Compass, Flame, Search, MessageCircle,
  ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { usePresence, useTrendingAlert, useBadgeAlert, useSubscriptionAlert } from "@/hooks/usePresence";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, logout } = useUser();
  const { isConnected: walletConnected } = useAccount();
  const [unreadCount, setUnreadCount] = useState(0);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [mutedIds, setMutedIds] = useState<Set<number>>(new Set());
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { onlineCount, wsEvent } = usePresence();
  const { alert: trendingAlert, dismiss: dismissTrending } = useTrendingAlert();
  const { alert: badgeAlert, dismiss: dismissBadge } = useBadgeAlert();
  const { alert: subAlert, dismiss: dismissSub } = useSubscriptionAlert();
  const { toast } = useToast();

  const onMessagesPage = location === "/messages" || location.startsWith("/messages/");

  const fetchDmUnread = () => {
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    if (!wallet) return;
    fetch(`${BASE}/api/dm/conversations`, { headers: { "x-wallet-address": wallet } })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((convs: { unreadCount: number }[]) => {
        const total = convs.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
        setDmUnreadCount(total);
      })
      .catch(() => {});
  };

  const fetchMutedIds = () => {
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    if (!wallet) return;
    fetch(`${BASE}/api/dm/muted`, { headers: { "x-wallet-address": wallet } })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((ids: number[]) => setMutedIds(new Set(ids)))
      .catch(() => {});
  };

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
    fetchDmUnread();
    fetchMutedIds();
    const interval = setInterval(() => { fetchCount(); fetchDmUnread(); fetchMutedIds(); }, 60_000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (onMessagesPage) setDmUnreadCount(0);
  }, [onMessagesPage]);

  useEffect(() => {
    if (!wsEvent) return;
    const ev = wsEvent as {
      type?: string;
      senderId?: number;
      senderName?: string | null;
      preview?: string | null;
    };
    if (ev.type === "new_dm" && !onMessagesPage) {
      const isMuted = ev.senderId !== undefined && mutedIds.has(ev.senderId);
      fetchDmUnread();
      if (!isMuted) {
        toast({
          title: ev.senderName ? `💬 ${ev.senderName}` : "💬 New message",
          description: ev.preview ?? "Sent you a message",
          duration: 6_000,
          action: (
            <ToastAction
              altText="Reply"
              onClick={() => navigate(`/messages?userId=${ev.senderId ?? ""}`)}
            >
              Reply
            </ToastAction>
          ),
        });
      }
    }
  }, [wsEvent, onMessagesPage, mutedIds]);

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

  useEffect(() => {
    if (!badgeAlert) return;
    toast({
      title: `${badgeAlert.badge.emoji} Badge earned: ${badgeAlert.badge.label}`,
      description: badgeAlert.badge.description,
      duration: 8_000,
    });
    dismissBadge();
  }, [badgeAlert?.badge.badgeType, badgeAlert?.seenAt]);

  useEffect(() => {
    if (!subAlert) return;
    const name = subAlert.subscriberName ?? subAlert.subscriberUsername ?? "Someone";
    const handle = subAlert.subscriberUsername ? `@${subAlert.subscriberUsername}` : null;
    toast({
      title: subAlert.isRenewal ? `🔄 Subscription renewed!` : `💜 New subscriber!`,
      description: subAlert.isRenewal
        ? `${handle ?? name} renewed their subscription to your exclusive content.`
        : `${handle ?? name} just subscribed to your exclusive content.`,
      duration: 8_000,
      action: subAlert.subscriberUsername ? (
        <ToastAction
          altText="View profile"
          onClick={() => navigate(`/profile/${subAlert.subscriberUsername}`)}
        >
          View
        </ToastAction>
      ) : undefined,
    });
    dismissSub();
  }, [subAlert?.subscriberId, subAlert?.seenAt]);

  const primaryNav = [
    { label: "Home", href: "/feed", icon: Home },
    { label: "Search", href: "/search", icon: Search },
    {
      label: "Messages",
      href: "/messages",
      icon: MessageCircle,
      badge: dmUnreadCount,
      badgeVariant: "red" as const,
    },
    { label: "Profile", href: `/profile/${user?.id ?? ""}`, icon: UserIcon },
  ];

  const secondaryNav = [
    { label: "Trending", href: "/trending", icon: Flame },
    {
      label: "Discover",
      href: "/discover",
      icon: Compass,
      badge: onlineCount > 0 ? onlineCount : 0,
      badgeVariant: "green" as const,
    },
    { label: "Exclusive", href: "/private", icon: Lock },
    { label: "Wallet", href: "/wallet", icon: Wallet },
    { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
    {
      label: "Notifications",
      href: "/notifications",
      icon: Bell,
      badge: unreadCount,
      badgeVariant: "red" as const,
    },
    { label: "On-Chain", href: "/chain", icon: Link2 },
  ];

  const isSecondaryActive = secondaryNav.some(
    (item) => location === item.href || location.startsWith(item.href + "/")
  );

  if (!walletConnected || !user) return <>{children}</>;

  const showBanner = !CONTRACT_DEPLOYED && !bannerDismissed;

  function NavItem({
    item,
  }: {
    item: { label: string; href: string; icon: React.ComponentType<{ className?: string }>; badge?: number; badgeVariant?: "red" | "green" };
  }) {
    const isActive = location === item.href || location.startsWith(item.href + "/");
    const Icon = item.icon;
    const badgeCount = item.badge ?? 0;
    const isGreenBadge = item.badgeVariant === "green";
    return (
      <Link
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
            <span
              className={`absolute -top-1.5 -right-1.5 h-4 w-4 text-white text-[10px] font-bold rounded-full flex items-center justify-center ${
                isGreenBadge ? "bg-green-500" : "bg-destructive"
              }`}
            >
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </div>
        {item.label}
        {item.href === "/chain" && (
          <span
            className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              CONTRACT_DEPLOYED ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
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
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar hidden md:flex flex-col justify-between fixed top-0 bottom-0 left-0 h-screen">
        <div className="flex flex-col flex-1 overflow-y-auto">
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

          {/* Primary nav */}
          <nav className="px-4 space-y-0.5">
            {primaryNav.map((item) => (
              <NavItem key={item.href} item={item} />
            ))}
          </nav>

          {/* More section */}
          <div className="px-4 mt-2">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${
                isSecondaryActive
                  ? "bg-sidebar-primary/10 text-sidebar-primary"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <span className="flex-1 text-left">More</span>
              {(unreadCount > 0 || dmUnreadCount > 0) && !moreOpen && (
                <span className="h-4 w-4 text-white text-[10px] font-bold rounded-full flex items-center justify-center bg-destructive">
                  !
                </span>
              )}
              {moreOpen ? (
                <ChevronUp className="h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 flex-shrink-0" />
              )}
            </button>
            {(moreOpen || isSecondaryActive) && (
              <div className="mt-0.5 space-y-0.5 pl-2 border-l-2 border-sidebar-border ml-3">
                {secondaryNav.map((item) => (
                  <NavItem key={item.href} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar footer — Settings + Sign Out */}
        <div className="p-4 border-t border-sidebar-border space-y-1">
          <Link
            href="/settings"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm ${
              location === "/settings"
                ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }`}
          >
            <Settings className="h-5 w-5" />
            Settings
          </Link>
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

      {/* Mobile bottom nav — primary only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background border-border flex justify-around p-2 z-50">
        {[...primaryNav].map((item) => {
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
                <span
                  className={`absolute top-1 right-1 h-3.5 w-3.5 text-white text-[9px] font-bold rounded-full flex items-center justify-center ${
                    isGreenBadge ? "bg-green-500" : "bg-destructive"
                  }`}
                >
                  {badgeCount > 9 ? "9+" : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
        {/* More button for mobile */}
        <button
          onClick={() => setMoreOpen((o) => !o)}
          className={`p-2 rounded-md relative ${isSecondaryActive ? "text-primary" : "text-muted-foreground"}`}
        >
          <Settings className="h-6 w-6" />
        </button>
      </div>

      {/* Mobile "More" drawer */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute bottom-16 left-0 right-0 bg-background border-t border-border rounded-t-2xl p-4 grid grid-cols-4 gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {[...secondaryNav, { label: "Settings", href: "/settings", icon: Settings }].map((item) => {
              const isActive = location === item.href || location.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
            <button
              onClick={() => { setMoreOpen(false); logout(); }}
              className="flex flex-col items-center gap-1 p-3 rounded-xl text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-5 w-5" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
