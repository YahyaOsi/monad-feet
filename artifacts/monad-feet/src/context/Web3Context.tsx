import { useEffect, useState, type ReactNode } from "react";
import { getDefaultConfig, getDefaultWallets, RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { backpackWallet } from "@rainbow-me/rainbowkit/wallets";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider, http } from "wagmi";
import { monad } from "wagmi/chains";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

// Official Monad mainnet chain definition (143, MON, https://rpc.monad.xyz).
export const monadMainnet = monad;
const config = getDefaultConfig({
  appName: "Monad Feet",
  // Use Backpack's official injected connector in its extension and mobile browser.
  // Preserve RainbowKit's default wallets, including WalletConnect and Safe.
  wallets: getDefaultWallets().wallets.map((group, index) =>
    index === 0 ? { ...group, wallets: [backpackWallet, ...group.wallets] } : group
  ),
  projectId: "0f8b4abd0914345866418eee18a790bb",
  chains: [monadMainnet],
  transports: { [monadMainnet.id]: http("https://rpc.monad.xyz") },
  ssr: false,
});

export function Web3Provider({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={isDark ? darkTheme() : lightTheme()}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}