"use client";

import useSWR from "swr";
import { ArrowUpRight, Circle } from "lucide-react";
import {
  ARBISCAN_URL,
  CHAIN_ID,
  EXPECTED_EOA,
  LAGOON_LP_URL,
  VAULT_ADDRESS,
  type StatusResponse,
} from "@etesia/shared";
import { fetchStatus } from "@/lib/status";
import { formatUsd, formatSignedUsd } from "@/lib/format";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 font-mono text-2xl text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-faint">{hint}</div> : null}
    </div>
  );
}

export default function Page(): React.JSX.Element {
  const { data, error, isLoading } = useSWR<StatusResponse>("status", fetchStatus, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });

  const nav = data?.nav;
  const vs = data?.vaultState;
  const sharePrice = vs?.sharePrice;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Etesia GMX</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Crypto signals executing onchain on GMX V2 (Arbitrum), wrapped in an ERC-7540 Lagoon vault
            with a GMX-aware NAV oracle.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-muted">
            <Circle
              className={data ? "fill-accent text-accent" : "fill-negative text-negative"}
              size={8}
            />
            {error ? "backend offline" : data ? "live" : "connecting…"}
          </span>
          {data ? (
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-muted">
              {data.dryRun ? "DRY_RUN" : "LIVE"} · {data.signalSource}
            </span>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="mt-6 rounded-xl border border-negative/40 bg-negative/10 p-4 text-sm text-ink">
          Can&apos;t reach the backend at the configured URL. Start it (`pnpm dev:backend`) or set
          <code className="mx-1 rounded bg-bg px-1">NEXT_PUBLIC_BACKEND_URL</code>.
        </div>
      ) : null}

      <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="NAV" value={nav ? formatUsd(nav.navUsd) : "—"} hint="GMX-aware total assets" />
        <Stat
          label="Share price"
          value={sharePrice != null ? sharePrice.toFixed(4) : "—"}
          hint={vs ? `supply ${(Number(vs.totalSupply) / 1e18).toFixed(2)}` : undefined}
        />
        <Stat label="Idle USDC" value={nav ? formatUsd(nav.idleUsd) : "—"} hint="held by trading EOA" />
        <Stat
          label="Positions net"
          value={nav ? formatUsd(nav.positionsNetUsd) : "—"}
          hint={nav && nav.pendingCollateralUsd > 0 ? `+${formatUsd(nav.pendingCollateralUsd)} pending` : undefined}
        />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          GMX positions
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Market</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3 text-right">Size (USD)</th>
                <th className="px-4 py-3 text-right">Net value</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                <tr>
                  <td className="px-4 py-6 text-muted" colSpan={4}>
                    Loading…
                  </td>
                </tr>
              ) : (data?.positions.length ?? 0) === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-faint" colSpan={4}>
                    No open positions.
                  </td>
                </tr>
              ) : (
                data?.positions.map((p) => (
                  <tr key={`${p.symbol}-${p.isLong}`} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-ink">{p.symbol}</td>
                    <td className={`px-4 py-3 ${p.isLong ? "text-accent" : "text-negative"}`}>
                      {p.isLong ? "LONG" : "SHORT"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatUsd(p.sizeUsd)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatSignedUsd(p.netValueUsd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
        <a className="inline-flex items-center gap-1 hover:text-accent" href={LAGOON_LP_URL} target="_blank" rel="noreferrer">
          Lagoon LP page <ArrowUpRight size={12} />
        </a>
        <a
          className="inline-flex items-center gap-1 hover:text-accent"
          href={`${ARBISCAN_URL}/address/${VAULT_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
        >
          Vault {short(VAULT_ADDRESS)} <ArrowUpRight size={12} />
        </a>
        <a
          className="inline-flex items-center gap-1 hover:text-accent"
          href={`${ARBISCAN_URL}/address/${EXPECTED_EOA}`}
          target="_blank"
          rel="noreferrer"
        >
          Trader {short(EXPECTED_EOA)} <ArrowUpRight size={12} />
        </a>
        <span className="text-faint">Arbitrum One · chain {CHAIN_ID}</span>
      </footer>
    </main>
  );
}
