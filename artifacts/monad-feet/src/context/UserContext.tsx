import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type User, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";

type SessionPhase = "checking" | "unsigned" | "signing" | "verified" | "error";

interface SessionState {
  address?: string;
  phase: SessionPhase;
  error?: string;
}

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  isError: boolean;
  profileError?: string;
  logout: () => void;
  session: SessionState;
  signIn: () => Promise<void>;
  retrySession: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const authUrl = (path: string) => `${BASE}/api/auth/${path}`;

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(authUrl(path), {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The wallet request failed. Please try again.";
}

export function UserProvider({ children }: { children: ReactNode }) {
  const { address, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const walletAddress = status === "connected" ? address : undefined;
  const currentAddress = useRef(walletAddress);
  currentAddress.current = walletAddress;
  const previousAddress = useRef<string | undefined>(undefined);
  const requestNumber = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const [retry, setRetry] = useState(0);
  const [session, setSession] = useState<SessionState>({ phase: "checking" });
  const isCurrent = (id: number, expected: string) =>
    requestNumber.current === id && currentAddress.current?.toLowerCase() === expected.toLowerCase();

  useEffect(() => {
    // Wagmi reconnects asynchronously. A temporary reconnecting state must not
    // delete the previous server session or flash the public landing screen.
    if (status === "connecting" || status === "reconnecting") return;
    const id = ++requestNumber.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const old = previousAddress.current;
    const changed = old?.toLowerCase() !== walletAddress?.toLowerCase();

    if (changed) {
      void queryClient.cancelQueries();
      queryClient.clear();
    }
    if (walletAddress) localStorage.setItem("mf_wallet_address", walletAddress);
    else localStorage.removeItem("mf_wallet_address");
    setSession({ address: walletAddress, phase: "checking" });

    async function checkSession() {
      try {
        if (changed && old) {
          // A cookie for the old account may not be reused by the new account.
          await authRequest<void>("logout", { method: "POST", signal: controller.signal });
        }
        if (controller.signal.aborted || id !== requestNumber.current) return;
        previousAddress.current = walletAddress;
        if (!walletAddress) {
          setSession({ phase: "unsigned" });
          return;
        }
        const result = await authRequest<{ walletAddress: string | null }>("session", {
          signal: controller.signal,
        });
        if (!isCurrent(id, walletAddress)) return;
        setSession({
          address: walletAddress,
          phase: result.walletAddress?.toLowerCase() === walletAddress.toLowerCase()
            ? "verified" : "unsigned",
        });
      } catch (error) {
        if (controller.signal.aborted || id !== requestNumber.current) return;
        if (errorStatus(error) === 401) {
          previousAddress.current = walletAddress;
          setSession({ address: walletAddress, phase: "unsigned" });
        } else {
          setSession({ address: walletAddress, phase: "error", error: `Session check failed: ${errorMessage(error)}` });
        }
      }
    }
    void checkSession();
    return () => controller.abort();
  }, [walletAddress, status, retry, queryClient]);

  const signIn = useCallback(async () => {
    const signingAddress = currentAddress.current;
    if (!signingAddress || (session.phase !== "unsigned" && session.phase !== "error")) return;
    // Don't start verification before a failed account-switch logout is retried.
    if (previousAddress.current?.toLowerCase() !== signingAddress.toLowerCase()) {
      setSession({ address: signingAddress, phase: "error", error: "Retry the session check before signing in." });
      return;
    }
    const id = ++requestNumber.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setSession({ address: signingAddress, phase: "signing" });
    try {
      const challenge = await authRequest<{ message: string }>("challenge", {
        method: "POST",
        body: JSON.stringify({ walletAddress: signingAddress }),
        signal: controller.signal,
      });
      if (!isCurrent(id, signingAddress) || controller.signal.aborted) return;
      if (!challenge.message) throw new Error("The server did not return a sign-in challenge.");
      const signature = await signMessageAsync({ message: challenge.message });
      if (!isCurrent(id, signingAddress) || controller.signal.aborted) return;
      const verified = await authRequest<{ walletAddress: string }>("verify", {
        method: "POST",
        body: JSON.stringify({ walletAddress: signingAddress, message: challenge.message, signature }),
        signal: controller.signal,
      });
      if (!isCurrent(id, signingAddress) || controller.signal.aborted) return;
      if (verified.walletAddress?.toLowerCase() !== signingAddress.toLowerCase()) {
        throw new Error("The server verified a different wallet. Please retry.");
      }
      const resumed = await authRequest<{ walletAddress: string | null }>("session", {
        signal: controller.signal,
      });
      if (!isCurrent(id, signingAddress) || controller.signal.aborted) return;
      if (resumed.walletAddress?.toLowerCase() !== signingAddress.toLowerCase()) {
        throw new Error("The signed wallet session could not be resumed.");
      }
      setSession({ address: signingAddress, phase: "verified" });
    } catch (error) {
      if (controller.signal.aborted || !isCurrent(id, signingAddress)) return;
      setSession({ address: signingAddress, phase: "error", error: `Sign-in failed: ${errorMessage(error)}` });
    }
  }, [session.phase, signMessageAsync]);

  const logout = () => {
    const id = ++requestNumber.current;
    activeRequest.current?.abort();
    setSession({ address: currentAddress.current, phase: "checking" });
    void (async () => {
      try {
        await authRequest<void>("logout", { method: "POST" });
        if (id !== requestNumber.current) return;
        previousAddress.current = undefined;
        void queryClient.cancelQueries();
        queryClient.clear();
        localStorage.removeItem("mf_wallet_address");
        disconnect();
      } catch (error) {
        if (id === requestNumber.current) {
          setSession({ address: currentAddress.current, phase: "error", error: `Logout failed: ${errorMessage(error)}. Please retry.` });
        }
      }
    })();
  };

  const verified = !!walletAddress
    && session.address?.toLowerCase() === walletAddress.toLowerCase()
    && session.phase === "verified";
  const { data, isPending, isFetching, isError: profileFailed, error: profileError } = useGetMe({
    query: {
      queryKey: [...getGetMeQueryKey(), walletAddress?.toLowerCase() ?? "disconnected"],
      enabled: verified,
      retry: false,
      staleTime: 0,
    },
    request: { credentials: "include" },
  });
  const profileNotFound = profileFailed && errorStatus(profileError) === 404;
  const isError = verified && profileFailed && !profileNotFound;
  const user = verified && data?.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    ? data : null;
  const isLoading = status === "connecting" || status === "reconnecting"
    || (!!walletAddress && (!verified || isPending || (isFetching && !data)));

  return (
    <UserContext.Provider value={{
      user, isLoading, isError,
      profileError: isError ? errorMessage(profileError) : undefined,
      logout, session, signIn, retrySession: () => setRetry(n => n + 1),
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) throw new Error("useUser must be used within a UserProvider");
  return context;
}