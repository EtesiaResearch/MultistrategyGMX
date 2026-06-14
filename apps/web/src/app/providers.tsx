"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, type State } from "wagmi";
import { getConfig } from "@/lib/wagmi";

/**
 * WagmiProvider → QueryClientProvider, with the SSR cookie state handed down
 * from the root layout (official wagmi Next.js App Router pattern).
 */
export function Providers({
  children,
  initialState,
}: {
  readonly children: ReactNode;
  readonly initialState: State | undefined;
}): React.JSX.Element {
  const [config] = useState(() => getConfig());
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
