import { describe, expect, it } from "vitest";
import { normalizeTargets, topNTargets } from "../../src/signal/scale.js";
import type { Target } from "../../src/signal/types.js";

const raw: Target[] = [
  { symbol: "BTC", signedNotionalUsd: 100 },
  { symbol: "ETH", signedNotionalUsd: -300 },
];

describe("normalizeTargets", () => {
  it("dynamic: rescales so Σ|notional| = nav × grossLeverage, preserving signs/ratios", () => {
    const out = normalizeTargets(raw, { dynamic: true, mirrorScale: 1, grossLeverage: 1, navUsd: 50 });
    // gross 400 -> target 50 -> scale 0.125
    expect(out).toEqual([
      { symbol: "BTC", signedNotionalUsd: 12.5 },
      { symbol: "ETH", signedNotionalUsd: -37.5 },
    ]);
    const gross = out.reduce((s, t) => s + Math.abs(t.signedNotionalUsd), 0);
    expect(gross).toBeCloseTo(50, 9);
  });

  it("dynamic: grossLeverage multiplies the target exposure", () => {
    const out = normalizeTargets(raw, { dynamic: true, mirrorScale: 1, grossLeverage: 2, navUsd: 50 });
    const gross = out.reduce((s, t) => s + Math.abs(t.signedNotionalUsd), 0);
    expect(gross).toBeCloseTo(100, 9);
  });

  it("dynamic: zero NAV or empty book -> all flat", () => {
    expect(normalizeTargets(raw, { dynamic: true, mirrorScale: 1, grossLeverage: 1, navUsd: 0 })).toEqual([
      { symbol: "BTC", signedNotionalUsd: 0 },
      { symbol: "ETH", signedNotionalUsd: 0 },
    ]);
    expect(normalizeTargets([], { dynamic: true, mirrorScale: 1, grossLeverage: 1, navUsd: 50 })).toEqual([]);
  });

  it("static: multiplies each notional by mirrorScale", () => {
    const out = normalizeTargets(raw, { dynamic: false, mirrorScale: 0.01, grossLeverage: 1, navUsd: 50 });
    expect(out).toEqual([
      { symbol: "BTC", signedNotionalUsd: 1 },
      { symbol: "ETH", signedNotionalUsd: -3 },
    ]);
  });
});

describe("topNTargets", () => {
  const book: Target[] = [
    { symbol: "A", signedNotionalUsd: 10 },
    { symbol: "B", signedNotionalUsd: -50 },
    { symbol: "C", signedNotionalUsd: 30 },
  ];
  it("keeps the N largest by |notional|, preserving sign", () => {
    expect(topNTargets(book, 2)).toEqual([
      { symbol: "B", signedNotionalUsd: -50 },
      { symbol: "C", signedNotionalUsd: 30 },
    ]);
  });
  it("n<=0 or n>=length keeps all (unsorted)", () => {
    expect(topNTargets(book, 0)).toBe(book);
    expect(topNTargets(book, 5)).toBe(book);
  });
});
