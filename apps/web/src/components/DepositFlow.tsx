"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { erc20Abi, formatUnits, maxUint256, zeroAddress, type Address } from "viem";
import { CheckCircle2 } from "lucide-react";
import { VaultUtils } from "@lagoon-protocol/v0-core";
import type { VaultCore } from "@/hooks/useVaultCore";
import type { UserPosition } from "@/hooks/useUserPosition";
import type { AssetAccount } from "@/hooks/useAssetAccount";
import { useTxFlow } from "@/hooks/useTxFlow";
import { formatTokenAmount, isMalformedAmount, parseAmountInput } from "@/lib/amount";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/vault";
import { AmountField, PrimaryButton, Stepper, TxStatusLine } from "./TxParts";
import { SettlementCountdown } from "./SettlementCountdown";

const vault = { address: VAULT_ADDRESS, abi: vaultAbi } as const;

type Phase = "success" | "claimable" | "pending" | "form";

/**
 * ERC-7540 async deposit: approve (exact by default) → requestDeposit →
 * settlement → claim → explicit "deposit complete" state. When
 * `isTotalAssetsValid()` is true onchain the sync path (`syncDeposit`) is used
 * instead — shares arrive in the same tx. One open request per controller
 * (vault error `OnlyOneRequestAllowed`): while a request is pending the form is
 * replaced by the pending state.
 */
export function DepositFlow({
  address,
  core,
  user,
  asset,
  disabled,
}: {
  readonly address: Address;
  readonly core: VaultCore;
  readonly user: UserPosition;
  readonly asset: AssetAccount;
  readonly disabled: boolean;
}): JSX.Element {
  const [input, setInput] = useState("");
  const [infiniteApprove, setInfiniteApprove] = useState(false);
  // Captured when the claim is sent — the reads zero out after settlement.
  const [lastClaimedShares, setLastClaimedShares] = useState<bigint | null>(null);
  const approveTx = useTxFlow();
  const requestTx = useTxFlow();
  const claimTx = useTxFlow();

  const { assetSymbol, assetDecimals, shareSymbol } = core;

  const phase: Phase =
    claimTx.status === "success"
      ? "success"
      : user.claimableDepositAssets > 0n
        ? "claimable"
        : user.pendingDepositAssets > 0n
          ? "pending"
          : "form";

  // Reset transient state on phase transitions so a finished (or refreshed)
  // flow never leaks a typed amount / stale tx status into the next one —
  // a leftover "Approve" + old amount reads as an unfinished deposit.
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current === phase) return;
    if (phase === "claimable") requestTx.reset();
    if (phase === "form") {
      setInput("");
      approveTx.reset();
      requestTx.reset();
    }
    prevPhase.current = phase;
  }, [phase, approveTx, requestTx]);

  // ---- Done: claimed — say it loudly, then offer a fresh form ----
  if (phase === "success") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-sm leading-relaxed text-ink">
            <span className="font-semibold">Deposit complete.</span>{" "}
            {lastClaimedShares !== null && (
              <>
                <span className="font-mono">
                  {formatTokenAmount(lastClaimedShares, core.vaultDecimals)} {shareSymbol}
                </span>{" "}
              </>
            )}
            shares are now in your wallet — they appear under “Your position” below.
          </p>
        </div>
        <TxStatusLine tx={claimTx} />
        <button
          type="button"
          onClick={() => {
            claimTx.reset();
            setLastClaimedShares(null);
          }}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
        >
          Make another deposit
        </button>
      </div>
    );
  }

  // ---- Claimable: a settled request waiting for its claim ----
  if (phase === "claimable") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink">
          <span className="font-semibold text-accent">Settled.</span> Your deposit of{" "}
          <span className="font-mono">
            {formatTokenAmount(user.claimableDepositAssets, assetDecimals)} {assetSymbol}
          </span>{" "}
          is ready — claim your{" "}
          <span className="font-mono">
            {formatTokenAmount(user.claimableShares, core.vaultDecimals)} {shareSymbol}
          </span>{" "}
          shares.
        </p>
        <PrimaryButton
          busy={claimTx.status === "wallet" || claimTx.status === "mining"}
          disabled={disabled}
          onClick={() => {
            setLastClaimedShares(user.claimableShares);
            claimTx.send({
              ...vault,
              functionName: "deposit",
              args: [user.claimableDepositAssets, address, address],
            });
          }}
        >
          Claim shares
        </PrimaryButton>
        <TxStatusLine tx={claimTx} />
      </div>
    );
  }

  // ---- Pending: requested, waiting for the next NAV settlement ----
  if (phase === "pending") {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-md border border-border bg-bg p-3 text-sm leading-relaxed text-ink">
          Deposit of{" "}
          <span className="font-mono font-semibold">
            {formatTokenAmount(user.pendingDepositAssets, assetDecimals)} {assetSymbol}
          </span>{" "}
          requested — it will be included at the next NAV settlement. Your shares become
          claimable here once settled.
        </p>
        <SettlementCountdown />
        <TxStatusLine tx={requestTx} />
      </div>
    );
  }

  // ---- Form ----
  const amount = parseAmountInput(input, assetDecimals);
  const malformed = isMalformedAmount(input, assetDecimals);
  const exceeds = amount !== null && amount > asset.balance;
  const needsApprove = amount !== null && asset.allowance < amount;
  const valid = amount !== null && amount > 0n && !exceeds;

  const previewShares =
    valid && core.totalSupply > 0n
      ? VaultUtils.convertToShares(amount, {
          totalAssets: core.totalAssets,
          totalSupply: core.totalSupply,
          decimalsOffset: core.decimalsOffset,
        })
      : null;

  // Validation only turns the field red once the user has actually entered an
  // amount — an untouched field (e.g. just landed on the page with an empty
  // wallet) must not look alarming. The empty-wallet notice shows as a calm
  // muted hint until then.
  const touched = input.trim().length > 0;
  const emptyWallet = asset.balance === 0n;

  const fieldError = !touched
    ? undefined
    : malformed
      ? `Invalid amount (max ${assetDecimals} decimals)`
      : emptyWallet
        ? `No ${assetSymbol} in this wallet`
        : exceeds
          ? `Exceeds wallet balance (${formatTokenAmount(asset.balance, assetDecimals)} ${assetSymbol})`
          : undefined;

  const fieldHint =
    previewShares !== null
      ? `≈ ${formatTokenAmount(previewShares, core.vaultDecimals)} ${shareSymbol} — indicative, final price set at settlement`
      : !touched && emptyWallet
        ? `No ${assetSymbol} in this wallet`
        : undefined;

  const approving = approveTx.status === "wallet" || approveTx.status === "mining";
  const requesting = requestTx.status === "wallet" || requestTx.status === "mining";

  return (
    <div className="flex flex-col gap-4">
      <AmountField
        id="deposit-amount"
        label={`Amount (${assetSymbol})`}
        value={input}
        onChange={(v) => setInput(v)}
        onMax={() => setInput(formatUnits(asset.balance, assetDecimals))}
        unit={assetSymbol}
        disabled={disabled}
        error={fieldError}
        hint={fieldHint}
      />

      {needsApprove && (
        <>
          <Stepper steps={[`Approve ${assetSymbol}`, "Request deposit"]} active={0} />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={infiniteApprove}
              onChange={(e) => setInfiniteApprove(e.target.checked)}
              disabled={disabled}
              className="h-3.5 w-3.5 accent-[#3DA5B0]"
            />
            Unlimited approval (off = exact amount only)
          </label>
          <PrimaryButton
            busy={approving}
            disabled={disabled || !valid}
            onClick={() => {
              if (amount === null) return;
              approveTx.send({
                address: core.assetAddress,
                abi: erc20Abi,
                functionName: "approve",
                args: [VAULT_ADDRESS, infiniteApprove ? maxUint256 : amount],
              });
            }}
          >
            Approve {assetSymbol}
          </PrimaryButton>
          <TxStatusLine tx={approveTx} />
        </>
      )}

      {!needsApprove && (
        <>
          {approveTx.status === "success" && (
            <Stepper steps={[`Approve ${assetSymbol}`, "Request deposit"]} active={1} />
          )}
          <PrimaryButton
            busy={requesting}
            disabled={disabled || !valid}
            onClick={() => {
              if (amount === null) return;
              // Sync path when the onchain NAV is fresh; async request else.
              requestTx.send(
                core.isTotalAssetsValid
                  ? { ...vault, functionName: "syncDeposit", args: [amount, address, zeroAddress] }
                  : { ...vault, functionName: "requestDeposit", args: [amount, address, address] },
              );
            }}
          >
            {core.isTotalAssetsValid ? "Deposit now" : "Request deposit"}
          </PrimaryButton>
          <TxStatusLine tx={requestTx} />
        </>
      )}
    </div>
  );
}
