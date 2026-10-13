import { Switch, Route, Router as WouterRouter, Redirect, useLocation, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Web3Provider } from "@/context/Web3Context";
import { ThemeProvider } from "@/context/ThemeContext";
import { UserProvider, useUser } from "@/context/UserContext";
import { WalletSessionGate } from "@/context/WalletSessionGate";
import { AppLayout } from "@/components/layout/AppLayout";
import { AnalyticsConsentBanner, AnalyticsPageTracker } from "@/components/AnalyticsPreferences";

import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Docs from "@/pages/docs";
import Roadmap from "@/pages/roadmap";
import Onboarding from "@/pages/onboarding";
import Feed from "@/pages/feed";
import PrivateFeed from "@/pages/private-feed";
import Wallet from "@/pages/wallet";
import Leaderboard from "@/pages/leaderboard";
import Profile from "@/pages/profile";
import Settings from "@/pages/settings";
import Notifications from "@/pages/notifications";
import ChainPage from "@/pages/chain";
import Discover from "@/pages/discover";
import PostDetail from "@/pages/post-detail";
import Trending from "@/pages/trending";
import SearchPage from "@/pages/search";
import MessagesPage from "@/pages/messages";
import DailyGame from "@/pages/daily";
import { useShareLoginPrompt } from "@/hooks/useShareLoginPrompt";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({
  component: Component,
  ...rest
}: {
  component: React.ComponentType<Record<string, unknown>>;
  [key: string]: unknown;
}) {
  const { user, isLoading } = useUser();
  if (isLoading)
    return (
      <div className="flex items-center justify-center min-h-[100dvh]" role="status" aria-label="Loading">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  if (!user) return <Redirect to="/" />;
  return <Component {...rest} />;
}

function PublicPostRoute() {
  const params = useParams();
  const { user } = useUser();
  const loginPrompt = useShareLoginPrompt();
  return (
    <>
      <PostDetail
        key={`${params.postId ?? ""}:${user ? `${user.id}:${user.walletAddress.toLowerCase()}` : "guest"}`}
        promptLogin={loginPrompt.promptLogin}
      />
      {loginPrompt.dialog}
    </>
  );
}

function PublicProfileRoute() {
  const params = useParams();
  const { user } = useUser();
  const loginPrompt = useShareLoginPrompt();
  return (
    <>
      <Profile
        key={`${params.userId ?? ""}:${user ? `${user.id}:${user.walletAddress.toLowerCase()}` : "guest"}`}
        promptLogin={loginPrompt.promptLogin}
      />
      {loginPrompt.dialog}
    </>
  );
}

function Router() {
  const [location] = useLocation();
  const { profileError } = useUser();
  const publicShareRoute = /^\/(?:post|profile)\/\d+$/.test(location);
  const publicInformationRoute = location === "/docs" || location === "/roadmap";
  const pages = (
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/docs" component={Docs} />
        <Route path="/roadmap" component={Roadmap} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/feed" component={() => <ProtectedRoute component={Feed} />} />
        <Route path="/discover" component={() => <ProtectedRoute component={Discover} />} />
        <Route path="/trending" component={() => <ProtectedRoute component={Trending} />} />
        <Route path="/post/:postId" component={PublicPostRoute} />
        <Route path="/private" component={() => <ProtectedRoute component={PrivateFeed} />} />
        <Route path="/wallet" component={() => <ProtectedRoute component={Wallet} />} />
        <Route path="/daily" component={() => <ProtectedRoute component={DailyGame} />} />
        <Route path="/leaderboard" component={() => <ProtectedRoute component={Leaderboard} />} />
        <Route path="/profile/:userId" component={PublicProfileRoute} />
        <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
        <Route path="/notifications" component={() => <ProtectedRoute component={Notifications} />} />
        <Route path="/chain" component={() => <ProtectedRoute component={ChainPage} />} />
        <Route path="/search" component={() => <ProtectedRoute component={SearchPage} />} />
        <Route path="/messages" component={() => <ProtectedRoute component={MessagesPage} />} />
        <Route component={NotFound} />
      </Switch>
  );
  const app = publicInformationRoute ? pages : <AppLayout>{pages}</AppLayout>;
  return publicShareRoute || publicInformationRoute
    ? app
    : <WalletSessionGate profileError={profileError}>{app}</WalletSessionGate>;
}

function App() {
  return (
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <Web3Provider queryClient={queryClient}>
        <UserProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AnalyticsPageTracker />
              <Router />
              <AnalyticsConsentBanner />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </UserProvider>
      </Web3Provider>
    </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
