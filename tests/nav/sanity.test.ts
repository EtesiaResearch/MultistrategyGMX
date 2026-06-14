import { describe, expect, it } from "vitest";
import { NavSanityError, sanityCheckNav } from "../../src/nav/push.js";

const base = { strictFirstNavZero: true, navDivergenceMaxBps: 1000 };

describe("sanityCheckNav", () => {
  it("allows first NAV = 0 on an empty vault", () => {
    expect(() => sanityCheckNav({ ...base, totalSupply: 0n, totalAssets: 0n, newNav: 0n })).not.toThrow();
  });

  it("rejects first NAV > 0 on an empty vault", () => {
    expect(() =>
      sanityCheckNav({ ...base, totalSupply: 0n, totalAssets: 0n, newNav: 1_000_000n }),
    ).toThrow(NavSanityError);
  });

  it("permits first NAV > 0 when the guard is disabled", () => {
    expect(() =>
      sanityCheckNav({ ...base, strictFirstNavZero: false, totalSupply: 0n, totalAssets: 0n, newNav: 1_000_000n }),
    ).not.toThrow();
  });

  it("allows a NAV within the divergence band", () => {
    // pps currently 1.0 (1:1). +5% is within the 10% band.
    expect(() =>
      sanityCheckNav({ ...base, totalSupply: 100_000_000n, totalAssets: 100_000_000n, newNav: 105_000_000n }),
    ).not.toThrow();
  });

  it("rejects a NAV beyond the divergence band", () => {
    // +20% swing exceeds the 10% cap.
    expect(() =>
      sanityCheckNav({ ...base, totalSupply: 100_000_000n, totalAssets: 100_000_000n, newNav: 120_000_000n }),
    ).toThrow(NavSanityError);
  });
});
