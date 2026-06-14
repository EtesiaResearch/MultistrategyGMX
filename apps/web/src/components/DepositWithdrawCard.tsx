"use client";

import { useState, type JSX } from "react";
import { useAccount } from "wagmi";
import { useVaultCore } from "@/hooks/useVaultCore";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useAssetAccount } from "@/hooks/useAssetAccount";
import { CHAIN } from "@/lib/wagmi";
import { cn } from "@/lib/utils";
import { ConnectWalletModal } from "./ConnectWalletModal";
import { DepositFlow } from "./DepositFlow";
import { PositionPanel } from "./PositionPanel";
import { Skeleton } from "./Skeleton";
import { WithdrawFlow } from "./WithdrawFlow";

type Tab = "deposit" | "withdraw";

/**
 * The money path. Deposits and withdrawals go through the Lagoon vault contract
 * ONLY — never the Safe (direct Safe transfers are booked as trading profit and
 * mint performance fees). Approvals are exact-amount by default.
 */
export function DepositWithdrawCard(): JSX.Element {
  const [tab, setTab] = useState<Tab>("deposit");
  const [modalOpen, setModalOpen] = useState(false);
  const { address, chainId } = useAccount();
  const core = useVaultCore();
  const user = useUserPosition(address);
  const asset = useAssetAccount(address, core?.assetAddress);

  const wrongChain = address !== undefined && chainId !== CHAIN.id;

  let body: JSX.Element;
  let stage: 0 | 1 | 2 = 0;

  if (address === undefined) {
    body = (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          Connect a wallet to deposit into the vault or withdraw your position.
        </p>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-full bg-cta px-4 py-3 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          Connect wallet
        </button>
        <ConnectWalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    );
  } else if (core === undefined || user === undefined || asset === undefined) {
    body = (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-16 bg-bg" />
        <Skeleton className="h-12 bg-bg" />
        <Skeleton className="h-12 bg-bg" />
      </div>
    );
  } else {
    stage =
      tab === "deposit"
        ? user.claimableDepositAssets > 0n
          ? 2
          : user.pendingDepositAssets > 0n
            ? 1
            : 0
        : user.claimableRedeemShares > 0n
          ? 2
          : user.pendingRedeemShares > 0n
            ? 1
            : 0;

    body = (
      <>
        <div className="flex flex-col gap-4 p-4">
          {wrongChain && (
            <p className="rounded-md border border-negative/60 bg-negative/10 p-3 text-xs text-ink">
              Wrong network — switch to Arbitrum One (banner above) to transact.
            </p>
          )}
          {tab === "deposit" ? (
            <DepositFlow
              address={address}
              core={core}
              user={user}
              asset={asset}
              disabled={wrongChain}
            />
          ) : (
            <WithdrawFlow address={address} core={core} user={user} disabled={wrongChain} />
          )}
        </div>
        <PositionPanel core={core} user={user} stage={stage} />
      </>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-2 border-b border-border" role="tablist">
        <TabButton active={tab === "deposit"} onClick={() => setTab("deposit")}>
          Deposit
        </TabButton>
        <TabButton active={tab === "withdraw"} onClick={() => setTab("withdraw")}>
          Withdraw
        </TabButton>
      </div>
      {body}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-4 py-3 text-sm font-semibold transition-colors",
        active
          ? "border-b-2 border-accent text-ink"
          : "border-b-2 border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
