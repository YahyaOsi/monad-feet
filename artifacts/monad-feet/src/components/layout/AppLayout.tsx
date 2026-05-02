import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { Home, Lock, Wallet, Trophy, User as UserIcon, Settings, LogOut, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useUser();
  const { isConnected } = useAccount();
  const [unreadCount, setUnreadCount] = useState(0);

  // Poll unread notification count every 60 seconds
  useEffect(() => {
    if (!user) return;
    const fetchCount = () => {
      const wallet = localStorage.getItem("mf_wallet_address") ?? "";
      fetch(`${BASE}/api/notifications`, {
        headers: { "x-wallet-address": wallet },
      })
        .then((r) => r.json())
        .then((d) => setUnreadCount(d.unreadCount ?? 0))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [user]);

  const navItems = [
    { label: "Feed", href: "/feed", icon: Home },
    { label: "Private", href: "/private", icon: Lock },
    { label: "Wallet", href: "/wallet", icon: Wallet },
    { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
    { label: "Profile", href: `/profile/${user?.id ?? ""}`, icon: UserIcon },
    { label: "Notifications", href: "/notifications", icon: Bell, badge: unreadCount },
    { label: "Settings", href: "/settings", icon: Settings },
  ];

  if (!isConnected || !user) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar hidden md:flex flex-col justify-between fixed top-0 bottom-0 left-0 h-screen">
        <div>
          <div className="p-6">
            <h1 className="text-2xl font-bold tracking-tight text-primary">Monad Feet</h1>
            <p className="text-sm text-sidebar-foreground/70">Exclusive Web3 Club</p>
          </div>
          <nav className="px-4 space-y-1">
            {navItems.map((item) => {
              const isActive = location === item.href || location.startsWith(item.href + "/");
              const Icon = item.icon;
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
                    {(item.badge ?? 0) > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 h-4 w-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                        {item.badge! > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </div>
                  {item.label}
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

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 max-w-4xl mx-auto w-full">
        {children}
      </main>

      {/* Mobile Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background border-border flex justify-around p-2 z-50">
        {navItems.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`p-2 rounded-md relative ${isActive ? "text-primary" : "text-muted-foreground"}`}
            >
              <Icon className="h-6 w-6" />
              {(item.badge ?? 0) > 0 && (
                <span className="absolute top-1 right-1 h-3.5 w-3.5 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
                  {item.badge! > 9 ? "9+" : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
