"use client";

import type { JSX, ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import type { TxFlow } from "@/hooks/useTxFlow";
import { EXPLORER_URL } from "@/lib/wagmi";
import { cn } from "@/lib/utils";

/** Shared building blocks for the deposit / withdraw transaction UIs. */

export function ExplorerTxLink({ hash }: { readonly hash: `0x${string}` }): JSX.Element {
  return (
    <a
      href={`${EXPLORER_URL}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-accent hover:underline"
    >
      View on explorer <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** One status line per transaction — wallet prompt, mining, error verbatim. */
export function TxStatusLine({ tx }: { readonly tx: TxFlow }): JSX.Element | null {
  if (tx.status === "idle") return null;
  if (tx.status === "wallet") {
    return <p className="text-xs text-muted">Confirm in your wallet…</p>;
  }
  if (tx.status === "mining") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
        Transaction submitted… {tx.hash !== undefined && <ExplorerTxLink hash={tx.hash} />}
      </p>
    );
  }
  if (tx.status === "error") {
    return (
      <div className="flex flex-col gap-1">
        <p className="break-words rounded-md border border-negative/50 bg-negative/10 p-2 text-xs leading-relaxed text-ink">
          {tx.error}
        </p>
        {tx.hash !== undefined && (
          <p className="text-xs">
            <ExplorerTxLink hash={tx.hash} />
          </p>
        )}
      </div>
    );
  }
  // success
  return (
    <p className="text-xs text-accent">
      Confirmed. {tx.hash !== undefined && <ExplorerTxLink hash={tx.hash} />}
    </p>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  busy,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled === true || busy === true}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-cta px-4 py-3 text-sm font-semibold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy === true && <Loader2 className="h-4 w-4 motion-safe:animate-spin" />}
      {children}
    </button>
  );
}

/** Two-step indicator: `1 Approve → 2 Request`. */
export function Stepper({
  steps,
  active,
}: {
  readonly steps: readonly string[];
  readonly active: number;
}): JSX.Element {
  return (
    <ol className="flex items-center gap-2 text-[11px]">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          {i > 0 && <span className="text-faint">→</span>}
          <span
            className={cn(
              "flex items-center gap-1.5",
              i === active ? "text-ink" : i < active ? "text-accent" : "text-faint",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold",
                i === active
                  ? "border-accent text-accent"
                  : i < active
                    ? "border-accent bg-accent text-bg"
                    : "border-faint",
              )}
            >
              {i + 1}
            </span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AmountField({
  id,
  label,
  value,
  onChange,
  onMax,
  unit,
  disabled,
  error,
  hint,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly onMax?: (() => void) | undefined;
  readonly unit: string;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
}): JSX.Element {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-muted" htmlFor={id}>
        {label}
      </label>
      <div
        className={cn(
          "mt-1 flex items-center gap-2 rounded-md border bg-bg px-3 py-2",
          error !== undefined ? "border-negative/70" : "border-border focus-within:border-accent",
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full min-w-0 bg-transparent font-mono text-lg text-ink placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <span className="text-xs font-semibold text-muted">{unit}</span>
        {onMax !== undefined && (
          <button
            type="button"
            onClick={onMax}
            disabled={disabled}
            className="rounded px-2 py-1 text-xs font-semibold uppercase text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:text-faint"
          >
            Max
          </button>
        )}
      </div>
      {error !== undefined ? (
        <p className="mt-1 text-xs text-negative">{error}</p>
      ) : hint !== undefined ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
