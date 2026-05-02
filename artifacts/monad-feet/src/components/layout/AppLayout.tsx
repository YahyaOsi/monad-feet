import { Link, useLocation } from "wouter";
import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { Home, Lock, Wallet, Trophy, User as UserIcon, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useUser();
  const { isConnected } = useAccount();

  const navItems = [
    { label: "Feed", href: "/feed", icon: Home },
    { label: "Private", href: "/private", icon: Lock },
    { label: "Wallet", href: "/wallet", icon: Wallet },
    { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
    { label: "Profile", href: `/profile/${user?.id || ""}`, icon: UserIcon },
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
          <nav className="px-4 space-y-2">
            {navItems.map((item) => {
              const isActive = location === item.href;
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
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-4 border-t border-sidebar-border">
          <Button variant="ghost" className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={logout}>
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
              className={`p-2 rounded-md ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-6 w-6" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
