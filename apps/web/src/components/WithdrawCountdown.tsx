"use client";

import { useEffect, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { fetchLatestRedeemRequestTs } from "@/lib/lagoon";

/**
 * Published withdrawal SLA: redemptions settle once funds are unwound from the
 * trading account — "typically within 48 hours". Copy-level expectation, not a
 * protocol constant.
 */
const WITHDRAW_SLA_HOURS = 48;

/**
 * Countdown to the 48h withdrawal window measured from the USER'S OWN redeem
 * request (timestamp from the Lagoon API). Withdrawals do NOT settle at the
 * next NAV tick — a pending redeem waits for liquidity to be unwound. Renders
 * nothing while the request isn't indexed yet.
 */
export function WithdrawCountdown({ address }: { readonly address: Address }): JSX.Element | null {
  const { data: requestTs } = useQuery({
    queryKey: ["lagoon", "redeem-request", address],
    queryFn: () => fetchLatestRedeemRequestTs(address),
    refetchInterval: 60_000,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (requestTs === undefined || requestTs === null) return null;

  const deadlineMs = (requestTs + WITHDRAW_SLA_HOURS * 3600) * 1000;
  const leftMs = deadlineMs - now;

  if (leftMs <= 0) {
    return (
      <div className="rounded-md border border-border bg-bg p-3">
        <p className="text-sm text-ink">Settlement is taking longer than usual.</p>
        <p className="mt-0.5 text-[11px] text-muted">
          Your funds stay claimable here as soon as the settlement lands.
        </p>
      </div>
    );
  }

  const h = Math.floor(leftMs / 3_600_000);
  const m = Math.floor((leftMs % 3_600_000) / 60_000);

  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <p className="text-sm text-ink">
        Funds expected to be claimable within{" "}
        <span className="font-mono font-semibold text-accent">
          {h}h {String(m).padStart(2, "0")}m
        </span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Counted from your withdrawal request — most settle much sooner.
      </p>
    </div>
  );
}
