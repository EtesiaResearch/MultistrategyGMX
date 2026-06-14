// `injected` comes from the main entry on purpose: the "wagmi/connectors"
// barrel pulls a broken `tempo` module in wagmi 3.6.16 (unresolvable
// 'accounts' import at webpack time).
import { cookieStorage, createConfig, createStorage, http, injected } from "wagmi";
import { arbitrum } from "wagmi/chains";

/**
 * Wallet stack: plain wagmi + viem, EIP-6963 discovery only — no wallet-UI
 * kit, no WalletConnect connector, no vendor account/projectId.
 *
 * `multiInjectedProviderDiscovery` stays at its default (true): EIP-6963
 * wallets (Rabby, MetaMask, OKX, …) self-announce and register as connectors.
 * The explicit `injected()` connector is a fallback for legacy in-app browsers
 * that only set `window.ethereum`; the connect modal hides it whenever
 * EIP-6963 wallets are present.
 */

/** The only chain this app runs on. */
export const CHAIN = arbitrum;

export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? CHAIN.blockExplorers.default.url;

export function getConfig() {
  return createConfig({
    chains: [CHAIN],
    connectors: [injected()],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [CHAIN.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_RPC ?? undefined),
    },
  });
}
