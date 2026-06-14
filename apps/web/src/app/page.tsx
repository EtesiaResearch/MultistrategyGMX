"use client";

import useSWR from "swr";
import { ArrowUpRight, Circle } from "lucide-react";
import {
  ARBISCAN_URL,
  CHAIN_ID,
  EXPECTED_EOA,
  VAULT_ADDRESS,
  type StatusResponse,
} from "@etesia/shared";
import { fetchStatus } from "@/lib/status";
import { formatUsd } from "@/lib/format";
import { Stat } from "@/components/Stat";
import { PositionsTable } from "@/components/PositionsTable";
import { VaultChart } from "@/components/VaultChart";
import { TopBar } from "@/components/TopBar";
import { ConnectButton } from "@/components/ConnectButton";
import { WrongChainBanner } from "@/components/WrongChainBanner";
import { DepositWithdrawCard } from "@/components/DepositWithdrawCard";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Page(): React.JSX.Element {
  const { data, error, isLoading } = useSWR<StatusResponse>("status", fetchStatus, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });

  const nav = data?.nav;
  const vs = data?.vaultState;
  const sharePrice = vs?.sharePrice;
  const firstLoad = isLoading && !data;

  return (
    <>
      <TopBar>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-muted">
            <Circle
              className={data ? "fill-accent text-accent" : "fill-negative text-negative"}
              size={8}
            />
            {error ? "backend offline" : data ? "live" : "connecting…"}
          </span>
          {data ? (
            <span className="hidden rounded-full border border-border bg-surface px-3 py-1 text-muted sm:inline">
              {data.dryRun ? "DRY_RUN" : "LIVE"}
            </span>
          ) : null}
          <ConnectButton />
        </div>
      </TopBar>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold text-ink">Etesia GMX</h1>
          <p className="mt-1 text-sm text-muted">Systematic strategy vault on GMX V2 · Arbitrum</p>
        </header>

        <WrongChainBanner />

        {error ? (
          <div className="mt-6 rounded-xl border border-negative/40 bg-negative/10 p-4 text-sm text-ink">
            Can&apos;t reach the backend at the configured URL. Start it (`pnpm dev:backend`) or set
            <code className="mx-1 rounded bg-bg px-1">NEXT_PUBLIC_BACKEND_URL</code>.
          </div>
        ) : null}

        <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="NAV" value={nav ? formatUsd(nav.navUsd) : "—"} hint="GMX-aware total assets" loading={firstLoad} />
          <Stat
            label="Share price"
            value={sharePrice != null ? sharePrice.toFixed(4) : "—"}
            hint={vs ? `supply ${(Number(vs.totalSupply) / 1e18).toFixed(2)}` : undefined}
            loading={firstLoad}
          />
          <Stat label="Idle USDC" value={nav ? formatUsd(nav.idleUsd) : "—"} hint="held by trading EOA" loading={firstLoad} />
          <Stat
            label="Positions net"
            value={nav ? formatUsd(nav.positionsNetUsd) : "—"}
            hint={nav && nav.pendingCollateralUsd > 0 ? `+${formatUsd(nav.pendingCollateralUsd)} pending` : undefined}
            loading={firstLoad}
          />
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="flex flex-col gap-8 lg:col-span-2">
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Performance</h2>
              <VaultChart />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">GMX positions</h2>
              <PositionsTable positions={data?.positions ?? []} loading={firstLoad} />
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Deposit / Withdraw</h2>
            <DepositWithdrawCard />
          </aside>
        </div>

        <footer className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
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
    </>
  );
}
