import type { Target } from "./types.js";

// Keep only the N largest positions by |notional| (n<=0 → keep all). Used to fit a
// large source book into a small vault without every leg falling below MIN_ORDER_USD.
export function topNTargets(raw: Target[], n: number): Target[] {
  if (n <= 0 || raw.length <= n) return raw;
  return [...raw].sort((a, b) => Math.abs(b.signedNotionalUsd) - Math.abs(a.signedNotionalUsd)).slice(0, n);
}

export interface ScaleOpts {
  dynamic: boolean;
  mirrorScale: number; // static fallback multiplier
  grossLeverage: number; // dynamic: target Σ|notional| = navUsd × grossLeverage
  navUsd: number; // current vault NAV (for dynamic)
}

// Scale a raw signal book (signed notionals) to this vault's size.
//   dynamic:  rescale so total gross exposure = navUsd × grossLeverage — a proportional
//             replica of the source book that auto-resizes as NAV grows.
//   static:   multiply every notional by mirrorScale.
// Pure — unit-tested.
export function normalizeTargets(raw: Target[], opts: ScaleOpts): Target[] {
  if (!opts.dynamic) {
    return raw.map((t) => ({ symbol: t.symbol, signedNotionalUsd: t.signedNotionalUsd * opts.mirrorScale }));
  }
  const gross = raw.reduce((s, t) => s + Math.abs(t.signedNotionalUsd), 0);
  if (gross <= 0 || opts.navUsd <= 0) {
    return raw.map((t) => ({ symbol: t.symbol, signedNotionalUsd: 0 }));
  }
  const scale = (opts.navUsd * opts.grossLeverage) / gross;
  return raw.map((t) => ({ symbol: t.symbol, signedNotionalUsd: t.signedNotionalUsd * scale }));
}
