"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { formatUnits, type Address } from "viem";
import { CheckCircle2 } from "lucide-react";
import { VaultUtils } from "@lagoon-protocol/v0-core";
import type { VaultCore } from "@/hooks/useVaultCore";
import type { UserPosition } from "@/hooks/useUserPosition";
import { useTxFlow } from "@/hooks/useTxFlow";
import { formatTokenAmount, isMalformedAmount, parseAmountInput } from "@/lib/amount";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/vault";
import { AmountField, PrimaryButton, TxStatusLine } from "./TxParts";
import { WithdrawCountdown } from "./WithdrawCountdown";

const vault = { address: VAULT_ADDRESS, abi: vaultAbi } as const;

type Phase = "success" | "claimable" | "pending" | "form";

/**
 * ERC-7540 redeem: requestRedeem → settlement → claim via `redeem` → explicit
 * "withdrawn" state. Max covers claimed + settled-but-unclaimed shares; when
 * the requested amount dips into unclaimed shares the single-tx
 * `claimSharesAndRequestRedeem` path is used. Redeem requests cannot be
 * cancelled once submitted (Lagoon docs).
 */
export function WithdrawFlow({
  address,
  core,
  user,
  disabled,
}: {
  readonly address: Address;
  readonly core: VaultCore;
  readonly user: UserPosition;
  readonly disabled: boolean;
}): JSX.Element {
  const [input, setInput] = useState("");
  // Captured when the claim is sent — the reads zero out after the tx.
  const [lastWithdrawnAssets, setLastWithdrawnAssets] = useState<bigint | null>(null);
  const requestTx = useTxFlow();
  const claimTx = useTxFlow();

  const { assetSymbol, vaultDecimals, shareSymbol } = core;

  const phase: Phase =
    claimTx.status === "success"
      ? "success"
      : user.claimableRedeemShares > 0n
        ? "claimable"
        : user.pendingRedeemShares > 0n
          ? "pending"
          : "form";

  // Reset transient state on phase transitions — a finished flow must never
  // leak a typed amount or a stale tx status into the next one.
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current === phase) return;
    if (phase === "claimable") requestTx.reset();
    if (phase === "form") {
      setInput("");
      requestTx.reset();
    }
    prevPhase.current = phase;
  }, [phase, requestTx]);

  // ---- Done: withdrawn — say it loudly, then offer a fresh form ----
  if (phase === "success") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-sm leading-relaxed text-ink">
            <span className="font-semibold">Withdrawn.</span>{" "}
            {lastWithdrawnAssets !== null && (
              <>
                <span className="font-mono">
                  {formatTokenAmount(lastWithdrawnAssets, core.assetDecimals)} {assetSymbol}
                </span>{" "}
              </>
            )}
            sent to your wallet.
          </p>
        </div>
        <TxStatusLine tx={claimTx} />
        <button
          type="button"
          onClick={() => {
            claimTx.reset();
            setLastWithdrawnAssets(null);
          }}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
        >
          Make another withdrawal
        </button>
      </div>
    );
  }

  // ---- Claimable: settled, assets ready to withdraw ----
  if (phase === "claimable") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink">
          <span className="font-semibold text-accent">Settled.</span> Withdraw{" "}
          <span className="font-mono">
            {formatTokenAmount(user.maxWithdrawAssets, core.assetDecimals)} {assetSymbol}
          </span>{" "}
          to your wallet.
        </p>
        <PrimaryButton
          busy={claimTx.status === "wallet" || claimTx.status === "mining"}
          disabled={disabled}
          onClick={() => {
            setLastWithdrawnAssets(user.maxWithdrawAssets);
            claimTx.send({
              ...vault,
              functionName: "redeem",
              args: [user.claimableRedeemShares, address, address],
            });
          }}
        >
          Withdraw {assetSymbol}
        </PrimaryButton>
        <TxStatusLine tx={claimTx} />
      </div>
    );
  }

  // ---- Pending: requested, waiting for settlement (48h expectation) ----
  if (phase === "pending") {
    const pendingAssets =
      core.totalSupply > 0n
        ? VaultUtils.convertToAssets(user.pendingRedeemShares, {
            totalAssets: core.totalAssets,
            totalSupply: core.totalSupply,
            decimalsOffset: core.decimalsOffset,
          })
        : 0n;
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-md border border-border bg-bg p-3 text-sm leading-relaxed text-ink">
          Withdrawal of{" "}
          <span className="font-mono font-semibold">
            {formatTokenAmount(user.pendingRedeemShares, vaultDecimals)} {shareSymbol}
          </span>{" "}
          (≈ {formatTokenAmount(pendingAssets, core.assetDecimals)} {assetSymbol}) requested.
          Withdrawals settle once funds are unwound from the trading account —{" "}
          <span className="font-semibold">typically within 48 hours</span>. Funds become
          claimable here once settled.
        </p>
        <WithdrawCountdown address={address} />
        <TxStatusLine tx={requestTx} />
      </div>
    );
  }

  // ---- Form ----
  const maxShares = user.balance + user.claimableShares;
  const shares = parseAmountInput(input, vaultDecimals);
  const malformed = isMalformedAmount(input, vaultDecimals);
  const exceeds = shares !== null && shares > maxShares;
  const valid = shares !== null && shares > 0n && !exceeds;
  const usesUnclaimed = valid && shares > user.balance;

  const previewAssets =
    valid && core.totalSupply > 0n
      ? VaultUtils.convertToAssets(shares, {
          totalAssets: core.totalAssets,
          totalSupply: core.totalSupply,
          decimalsOffset: core.decimalsOffset,
        })
      : null;

  const fieldError = malformed
    ? `Invalid amount (max ${vaultDecimals} decimals)`
    : exceeds
      ? `Exceeds redeemable shares (${formatTokenAmount(maxShares, vaultDecimals)} ${shareSymbol})`
      : maxShares === 0n
        ? `No ${shareSymbol} shares to withdraw`
        : undefined;

  const requesting = requestTx.status === "wallet" || requestTx.status === "mining";

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-border bg-bg p-3 text-xs leading-relaxed text-muted">
        Withdrawals settle once funds are unwound from the trading account —{" "}
        <span className="font-semibold text-ink">typically within 48 hours</span>. Requests
        cannot be cancelled once submitted.
      </p>

      <AmountField
        id="withdraw-shares"
        label={`Amount (${shareSymbol} shares)`}
        value={input}
        onChange={(v) => setInput(v)}
        onMax={() => setInput(formatUnits(maxShares, vaultDecimals))}
        unit={shareSymbol}
        disabled={disabled}
        error={fieldError}
        hint={
          previewAssets !== null
            ? `≈ ${formatTokenAmount(previewAssets, core.assetDecimals)} ${assetSymbol} — indicative, final price set at settlement${
                usesUnclaimed ? ". Includes unclaimed shares (claimed in the same transaction)" : ""
              }`
            : undefined
        }
      />

      <PrimaryButton
        busy={requesting}
        disabled={disabled || !valid}
        onClick={() => {
          if (shares === null) return;
          // Dipping into settled-but-unclaimed shares → single-tx variant.
          requestTx.send(
            usesUnclaimed
              ? { ...vault, functionName: "claimSharesAndRequestRedeem", args: [shares] }
              : { ...vault, functionName: "requestRedeem", args: [shares, address, address] },
          );
        }}
      >
        Request withdrawal
      </PrimaryButton>
      <TxStatusLine tx={requestTx} />
    </div>
  );
}
