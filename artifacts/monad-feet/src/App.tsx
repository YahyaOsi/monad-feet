import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Web3Provider } from "@/context/Web3Context";
import { UserProvider, useUser } from "@/context/UserContext";
import { AppLayout } from "@/components/layout/AppLayout";

import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  if (!user) return <Redirect to="/" />;
  return <Component {...rest} />;
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/feed" component={() => <ProtectedRoute component={Feed} />} />
        <Route path="/discover" component={() => <ProtectedRoute component={Discover} />} />
        <Route path="/trending" component={() => <ProtectedRoute component={Trending} />} />
        <Route
          path="/post/:postId"
          component={({ params }: { params: { postId: string } }) => (
            <ProtectedRoute component={PostDetail} postId={parseInt(params.postId)} />
          )}
        />
        <Route path="/private" component={() => <ProtectedRoute component={PrivateFeed} />} />
        <Route path="/wallet" component={() => <ProtectedRoute component={Wallet} />} />
        <Route path="/leaderboard" component={() => <ProtectedRoute component={Leaderboard} />} />
        <Route
          path="/profile/:userId"
          component={({ params }: { params: { userId: string } }) => (
            <ProtectedRoute component={Profile} userId={parseInt(params.userId)} />
          )}
        />
        <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
        <Route path="/notifications" component={() => <ProtectedRoute component={Notifications} />} />
        <Route path="/chain" component={() => <ProtectedRoute component={ChainPage} />} />
        <Route path="/search" component={() => <ProtectedRoute component={SearchPage} />} />
        <Route path="/messages" component={() => <ProtectedRoute component={MessagesPage} />} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Web3Provider queryClient={queryClient}>
        <UserProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </UserProvider>
      </Web3Provider>
    </QueryClientProvider>
  );
}

export default App;
