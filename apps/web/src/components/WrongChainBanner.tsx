"use client";

import { useState, type JSX } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { useAccount, useSwitchChain } from "wagmi";
import { CHAIN } from "@/lib/wagmi";

/**
 * Shown whenever the connected wallet sits on another chain. The switch action
 * falls back to wallet_addEthereumChain (4902) for wallets that have never seen
 * the chain.
 */
export function WrongChainBanner(): JSX.Element | null {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);

  if (address === undefined || chainId === CHAIN.id) return null;

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-lg border border-negative/60 bg-negative/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <TriangleAlert className="h-5 w-5 shrink-0 text-negative" />
        <p className="text-sm text-ink">
          Wrong network — this app runs on{" "}
          <span className="font-semibold">Arbitrum One (chain {CHAIN.id})</span>.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            switchChainAsync({ chainId: CHAIN.id }).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
          className="flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 motion-safe:animate-spin" />}
          Switch to Arbitrum One
        </button>
        {error !== null && (
          <p className="max-w-xs break-words text-right text-xs text-negative">{error}</p>
        )}
      </div>
    </div>
  );
}
