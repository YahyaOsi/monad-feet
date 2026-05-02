import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { Redirect } from "wouter";

export default function Landing() {
  const { isConnected } = useAccount();
  const { user, isLoading } = useUser();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (isConnected && user) {
    return <Redirect to="/feed" />;
  }

  if (isConnected && !user) {
    return <Redirect to="/onboarding" />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="z-10 text-center space-y-6 max-w-md px-4">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground">
          Monad Feet
        </h1>
        <p className="text-xl text-muted-foreground font-light">
          The Monad community you were invited to.
        </p>
        
        <div className="pt-8">
          <appkit-button />
        </div>

        <p className="text-sm text-muted-foreground/60 mt-12">
          An exclusive, invite-only Web3 social club.
        </p>
      </div>
    </div>
  );
}
