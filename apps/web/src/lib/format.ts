/**
 * Display-only formatting. `Number()` is fine here — this is the render
 * boundary (CLAUDE.md: never use `Number()` for arithmetic that feeds the DB,
 * but formatting for display is explicitly allowed).
 */

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `$1,234.56`. */
export function formatUsd(v: string | number): string {
  return usd2.format(Number(v));
}

/** `+$12.34` / `-$5.00` — signed, magnitude formatted as USD. */
export function formatSignedUsd(v: string | number): string {
  const n = Number(v);
  const body = usd2.format(Math.abs(n));
  return n < 0 ? `-${body}` : `+${body}`;
}

/** `+4.50%` / `-2.10%`. */
export function formatPercent(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

/** Price with adaptive precision, `$`-prefixed. `null` → em dash. */
export function formatPrice(v: string | null): string {
  if (v === null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const decimals = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: decimals })}`;
}

/** Token amount with adaptive precision (no currency symbol). */
export function formatAmount(v: string, opts?: { readonly grouping?: boolean }): string {
  const n = Math.abs(Number(v));
  const decimals = n >= 1 ? 4 : 8;
  return n.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    useGrouping: opts?.grouping ?? true,
  });
}

/** `ROE = unrealizedPnl / marginUsed × 100`. `null` when margin is 0. */
export function roePercent(unrealizedPnl: string, marginUsed: string): number | null {
  const m = Number(marginUsed);
  if (!Number.isFinite(m) || m === 0) return null;
  return (Number(unrealizedPnl) / m) * 100;
}

/** `cross` → `Cross`. */
export function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
