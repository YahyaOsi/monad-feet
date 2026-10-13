import {
  Home, Lock, Wallet, Trophy, User, Bell, Link2, Compass, Flame, Search, MessageCircle, Footprints,
  type LucideIcon,
} from "lucide-react";

export interface AppNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  badgeVariant?: "red" | "green";
}

export function getAppNavigation({
  userId, unreadCount, dmUnreadCount, onlineCount,
}: { userId?: number; unreadCount: number; dmUnreadCount: number; onlineCount: number }) {
  const primaryNav: AppNavItem[] = [
    { label: "Home", href: "/feed", icon: Home },
    { label: "Search", href: "/search", icon: Search },
    { label: "Daily", href: "/daily", icon: Footprints },
    { label: "Notifications", href: "/notifications", icon: Bell, badge: unreadCount, badgeVariant: "red" },
    { label: "Profile", href: `/profile/${userId ?? ""}`, icon: User },
  ];
  const secondaryNav: AppNavItem[] = [
    { label: "Trending", href: "/trending", icon: Flame },
    { label: "Discover", href: "/discover", icon: Compass, badge: Math.max(0, onlineCount), badgeVariant: "green" },
    { label: "Exclusive", href: "/private", icon: Lock },
    { label: "Wallet", href: "/wallet", icon: Wallet },
    { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
    { label: "Messages", href: "/messages", icon: MessageCircle, badge: dmUnreadCount, badgeVariant: "red" },
    { label: "Onchain", href: "/chain", icon: Link2 },
  ];
  return { primaryNav, secondaryNav };
}

export function navBadgeLabel(item: AppNavItem): string {
  const count = item.badge ?? 0;
  // Notification counts are exact numbers, including counts above nine.
  return item.href === "/notifications" || count <= 9 ? String(count) : "9+";
}