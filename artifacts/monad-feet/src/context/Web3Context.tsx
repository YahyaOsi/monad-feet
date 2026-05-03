import { ReactNode } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { defineChain } from '@reown/appkit/networks';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

const projectId = '19c9787ece0fcd04698c96c998167b4a';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  network: 'monad-testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://testnet-rpc.monad.xyz',
        'https://rpc.ankr.com/monad_testnet',
        'https://monad-testnet.drpc.org',
      ],
      webSocket: ['wss://testnet-rpc.monad.xyz/ws'],
    },
    public: {
      http: [
        'https://testnet-rpc.monad.xyz',
        'https://rpc.ankr.com/monad_testnet',
        'https://monad-testnet.drpc.org',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'MonadScan', url: 'https://testnet.monadexplorer.com' },
    monadScan: { name: 'MonadScan', url: 'https://monadscan.com' },
  },
  testnet: true,
});

const networks = [monadTestnet] as const;

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  features: {
    email: true,
    socials: ['x'],
    analytics: false,
  },
  metadata: {
    name: 'Monad Feet',
    description: 'The invite-only Web3 social club on Monad',
    url: 'https://monadfeet.replit.app',
    icons: [],
  },
});

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export function Web3Provider({ children, queryClient }: { children: ReactNode, queryClient: QueryClient }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
