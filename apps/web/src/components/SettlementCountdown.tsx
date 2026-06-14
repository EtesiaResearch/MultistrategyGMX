"use client";

import { useEffect, useState, type JSX } from "react";

/**
 * Countdown to the next settlement window. The NAV cycle runs on a fixed cron
 * and settles pending requests at the next tick (NAV sanity guard permitting).
 * The cadence is mirrored here via NEXT_PUBLIC_SETTLE_CYCLE_MINUTES so an ops
 * change is a one-env update; the 48h figure stays the conservative maximum (a
 * guard-blocked NAV can delay settles until resolved).
 */
const CYCLE_MINUTES = (() => {
  const n = Number(process.env.NEXT_PUBLIC_SETTLE_CYCLE_MINUTES ?? "15");
  return Number.isInteger(n) && n > 0 && n <= 60 ? n : 15;
})();

function remainingMs(now: number): number {
  const cycleMs = CYCLE_MINUTES * 60_000;
  return cycleMs - (now % cycleMs);
}

export function SettlementCountdown(): JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const ms = remainingMs(now);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);

  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <p className="text-sm text-ink">
        Next settlement window in{" "}
        <span className="font-mono font-semibold text-accent">
          {m}:{String(s).padStart(2, "0")}
        </span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Requests usually settle within minutes; 48h is the conservative maximum.
      </p>
    </div>
  );
}
