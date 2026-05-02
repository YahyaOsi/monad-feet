import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User } from "@workspace/api-client-react/src/generated/api.schemas";
import { useGetMe } from "@workspace/api-client-react";
import { useAccount, useDisconnect } from "wagmi";

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  isError: boolean;
  logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  
  useEffect(() => {
    if (address && isConnected) {
      localStorage.setItem("mf_wallet_address", address);
    } else {
      localStorage.removeItem("mf_wallet_address");
    }
  }, [address, isConnected]);

  const walletAddress = typeof localStorage !== "undefined" ? localStorage.getItem("mf_wallet_address") : null;

  const { data: user, isLoading, isError } = useGetMe({
    query: {
      enabled: !!walletAddress,
      retry: false, // Don't retry on 404
    }
  });

  const logout = () => {
    disconnect();
    localStorage.removeItem("mf_wallet_address");
  };

  return (
    <UserContext.Provider value={{ user: user || null, isLoading, isError, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
