import { describe, expect, it } from "vitest";
import { assembleNav } from "../../src/nav/assemble.js";
import { usdToGmxUsd } from "../../src/gmx/converters.js";

describe("assembleNav", () => {
  it("idle only", () => {
    const nav = assembleNav({ idleUsdc6: 100_000_000n, positionNetValues1e30: [], pendingIncreaseCollateral6: [] });
    expect(nav.navUsdc6).toBe(100_000_000n);
  });

  it("idle + position net value (1e30 -> 6dp)", () => {
    const nav = assembleNav({
      idleUsdc6: 50_000_000n, // 50 USDC idle
      positionNetValues1e30: [usdToGmxUsd(14.5)], // a position worth $14.50 net
      pendingIncreaseCollateral6: [],
    });
    expect(nav.positionsNetUsd6).toBe(14_500_000n);
    expect(nav.navUsdc6).toBe(64_500_000n);
  });

  it("counts pending-increase collateral exactly once", () => {
    // Mid-flight: collateral left the EOA into the OrderVault, position not yet open.
    const nav = assembleNav({
      idleUsdc6: 85_000_000n, // 100 - 15 collateral already sent
      positionNetValues1e30: [],
      pendingIncreaseCollateral6: [15_000_000n],
    });
    expect(nav.pendingCollateralUsd6).toBe(15_000_000n);
    expect(nav.navUsdc6).toBe(100_000_000n); // restored to the pre-order total
  });

  it("sums multiple positions", () => {
    const nav = assembleNav({
      idleUsdc6: 0n,
      positionNetValues1e30: [usdToGmxUsd(10), usdToGmxUsd(20.25)],
      pendingIncreaseCollateral6: [],
    });
    expect(nav.navUsdc6).toBe(30_250_000n);
  });

  it("idle is the ONLY balance term — Silo/vault balances are excluded by construction", () => {
    // NAV idle = balanceOf(E) only. assembleNav takes no silo/vault balance input, so
    // pending Lagoon deposits (which sit in the Silo until settle) can never be
    // double-counted. This pins that contract: NAV == idle + Σnet + Σpending, nothing else.
    const idleUsdc6 = 42_000_000n;
    const nav = assembleNav({
      idleUsdc6,
      positionNetValues1e30: [usdToGmxUsd(8)],
      pendingIncreaseCollateral6: [3_000_000n],
    });
    expect(nav.navUsdc6).toBe(idleUsdc6 + 8_000_000n + 3_000_000n);
    expect(Object.keys(nav).sort()).toEqual(
      ["idleUsdc6", "navUsdc6", "pendingCollateralUsd6", "positionsNetUsd6"].sort(),
    );
  });

  it("floors at zero", () => {
    const nav = assembleNav({
      idleUsdc6: 0n,
      positionNetValues1e30: [-usdToGmxUsd(5)],
      pendingIncreaseCollateral6: [],
    });
    expect(nav.navUsdc6).toBe(0n);
  });
});
