import { describe, expect, it } from "vitest";
import type { PositionInfo } from "@gmx-io/sdk/types/positions";
import { computeMinOrderFloor, planReconcile, positionsBySymbol } from "../../src/gmx/reconcile.js";
import { usdToGmxUsd } from "../../src/gmx/converters.js";
import type { Target } from "../../src/signal/types.js";

const CFG = { minOrderUsd: 15, maxTotalNotionalUsd: 200 };

// Minimal PositionInfo — planReconcile only reads sizeInUsd, isLong, indexToken.symbol.
function mkPos(symbol: string, isLong: boolean, sizeUsd: number): PositionInfo {
  return {
    sizeInUsd: usdToGmxUsd(sizeUsd),
    isLong,
    indexToken: { symbol },
  } as unknown as PositionInfo;
}

function plan(targets: Target[], positions: PositionInfo[], cfg = CFG) {
  return planReconcile(targets, positionsBySymbol(positions), cfg);
}

describe("planReconcile", () => {
  it("opens a long from flat", () => {
    const { steps } = plan([{ symbol: "BTC", signedNotionalUsd: 30 }], []);
    expect(steps).toEqual([
      { type: "increase", symbol: "BTC", isLong: true, notionalUsd: 30, reason: expect.any(String) },
    ]);
  });

  it("opens a short from flat", () => {
    const { steps } = plan([{ symbol: "ETH", signedNotionalUsd: -30 }], []);
    expect(steps[0]).toMatchObject({ type: "increase", isLong: false, notionalUsd: 30 });
  });

  it("flattens when target is absent", () => {
    const { steps } = plan([], [mkPos("BTC", true, 30)]);
    expect(steps[0]).toMatchObject({ type: "decrease", fullClose: true, closeNotionalUsd: 30 });
  });

  it("grows the same side", () => {
    const { steps } = plan([{ symbol: "BTC", signedNotionalUsd: 50 }], [mkPos("BTC", true, 30)]);
    expect(steps[0]).toMatchObject({ type: "increase", isLong: true, notionalUsd: 20 });
  });

  it("trims the same side", () => {
    const { steps } = plan([{ symbol: "BTC", signedNotionalUsd: 30 }], [mkPos("BTC", true, 50)]);
    expect(steps[0]).toMatchObject({ type: "decrease", fullClose: false, closeNotionalUsd: 20 });
  });

  it("flips long -> short as close then open", () => {
    const { steps } = plan([{ symbol: "BTC", signedNotionalUsd: -20 }], [mkPos("BTC", true, 30)]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: "decrease", fullClose: true, closeNotionalUsd: 30 });
    expect(steps[1]).toMatchObject({ type: "increase", isLong: false, notionalUsd: 20 });
  });

  it("skips sub-minimum GROWS but always closes a sub-minimum position", () => {
    // grow of +0.5 is below the $15 min -> skipped
    expect(plan([{ symbol: "BTC", signedNotionalUsd: 30.5 }], [mkPos("BTC", true, 30)]).steps).toHaveLength(0);
    // a $5 position flattened (target absent) MUST close even though 5 < min 15
    const { steps } = plan([], [mkPos("ETH", true, 5)]);
    expect(steps).toEqual([
      { type: "decrease", symbol: "ETH", position: expect.anything(), closeNotionalUsd: 5, fullClose: true, reason: expect.any(String) },
    ]);
  });

  it("flips to a sub-minimum other side -> closes only (goes flat)", () => {
    const { steps } = plan([{ symbol: "BTC", signedNotionalUsd: -4 }], [mkPos("BTC", true, 30)]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "decrease", fullClose: true, closeNotionalUsd: 30 });
  });

  it("derives the min-order floor from GMX min collateral (× leverage × margin), with fallback", () => {
    // minCollateral $2, leverage 2, margin 1.5 -> floor $6 (so a $7-16 leg clears it)
    expect(computeMinOrderFloor(2, 2, 1.5, 5)).toBe(6);
    // read failed (null) -> fallback
    expect(computeMinOrderFloor(null, 2, 1.5, 5)).toBe(5);
    expect(computeMinOrderFloor(0, 2, 1.5, 5)).toBe(5);
  });

  it("scales targets down to the gross notional cap", () => {
    const { steps, scale } = plan(
      [
        { symbol: "BTC", signedNotionalUsd: 200 },
        { symbol: "ETH", signedNotionalUsd: -200 },
      ],
      [],
    );
    expect(scale).toBe(0.5); // 400 -> cap 200
    const btc = steps.find((s) => s.symbol === "BTC");
    expect(btc).toMatchObject({ type: "increase", notionalUsd: 100 });
  });
});
