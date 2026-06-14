"use client";

import type { JSX } from "react";
import { VaultUtils } from "@lagoon-protocol/v0-core";
import type { VaultCore } from "@/hooks/useVaultCore";
import type { UserPosition } from "@/hooks/useUserPosition";
import { formatTokenAmount } from "@/lib/amount";
import { Stepper } from "./TxParts";

/**
 * "Your position" under the deposit/withdraw form: share breakdown, asset
 * value, pending/claimable amounts and the request lifecycle. `stage` marks
 * where the active tab's flow currently sits (0 Request, 1 Settlement,
 * 2 Claim).
 */
export function PositionPanel({
  core,
  user,
  stage,
}: {
  readonly core: VaultCore;
  readonly user: UserPosition;
  readonly stage: 0 | 1 | 2;
}): JSX.Element {
  const value =
    core.totalSupply > 0n
      ? VaultUtils.convertToAssets(user.totalShares, {
          totalAssets: core.totalAssets,
          totalSupply: core.totalSupply,
          decimalsOffset: core.decimalsOffset,
        })
      : 0n;

  const rows: { label: string; value: string; sub?: string }[] = [
    {
      label: "Your shares",
      value: `${formatTokenAmount(user.totalShares, core.vaultDecimals)} ${core.shareSymbol}`,
      ...(user.claimableShares > 0n || user.pendingRedeemShares > 0n
        ? {
            sub: `wallet ${formatTokenAmount(user.balance, core.vaultDecimals)} · unclaimed ${formatTokenAmount(user.claimableShares, core.vaultDecimals)} · pending redeem ${formatTokenAmount(user.pendingRedeemShares, core.vaultDecimals)}`,
          }
        : {}),
    },
    {
      label: "Value",
      value: `${formatTokenAmount(value, core.assetDecimals)} ${core.assetSymbol}`,
    },
  ];
  if (user.pendingDepositAssets > 0n) {
    rows.push({
      label: "Pending deposit",
      value: `${formatTokenAmount(user.pendingDepositAssets, core.assetDecimals)} ${core.assetSymbol}`,
    });
  }
  if (user.pendingRedeemShares > 0n) {
    rows.push({
      label: "Pending withdrawal",
      value: `${formatTokenAmount(user.pendingRedeemShares, core.vaultDecimals)} ${core.shareSymbol}`,
    });
  }
  if (user.claimableDepositAssets > 0n) {
    rows.push({
      label: "Claimable shares",
      value: `${formatTokenAmount(user.claimableShares, core.vaultDecimals)} ${core.shareSymbol}`,
    });
  }
  if (user.maxWithdrawAssets > 0n) {
    rows.push({
      label: "Claimable withdrawal",
      value: `${formatTokenAmount(user.maxWithdrawAssets, core.assetDecimals)} ${core.assetSymbol}`,
    });
  }

  return (
    <div className="border-t border-border p-4">
      <h3 className="mb-3 text-[11px] uppercase tracking-wide text-muted">Your position</h3>
      <dl className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-muted">{r.label}</dt>
            <dd className="text-right">
              <span className="font-mono text-sm text-ink">{r.value}</span>
              {r.sub !== undefined && (
                <span className="block font-mono text-[10px] text-faint">{r.sub}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <Stepper steps={["Request", "Settlement", "Claim"]} active={stage} />
      </div>
    </div>
  );
}
