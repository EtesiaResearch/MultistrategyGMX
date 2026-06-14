import { describe, expect, it } from "vitest";
import {
  acceptablePrice,
  acceptablePriceSide,
  applySlippageBps,
  collateralUsdc6ForNotional,
  gmxUsdToNumber,
  gmxUsdToUsdc6,
  parseUsdc6,
  usdToGmxUsd,
  usdToUsdc6,
  usdc6ToGmxUsd,
  usdc6ToNumber,
} from "../../src/gmx/converters.js";

const E30 = 10n ** 30n;
const E24 = 10n ** 24n;

describe("usd <-> gmx 1e30", () => {
  it("scales whole dollars to 1e30", () => {
    expect(usdToGmxUsd(1)).toBe(E30);
    expect(usdToGmxUsd(15)).toBe(15n * E30);
  });
  it("preserves 6 decimals of precision", () => {
    expect(usdToGmxUsd(0.000001)).toBe(E24); // 1 micro-USD
    expect(usdToGmxUsd(15.5)).toBe(15_500_000n * E24);
  });
  it("round-trips to number for display", () => {
    expect(gmxUsdToNumber(15n * E30)).toBe(15);
    expect(gmxUsdToNumber(usdToGmxUsd(123.45))).toBeCloseTo(123.45, 6);
  });
});

describe("gmx 1e30 <-> usdc 6dp", () => {
  it("floors 1e30 USD to 6dp", () => {
    expect(gmxUsdToUsdc6(15n * E30)).toBe(15_000_000n);
    expect(gmxUsdToUsdc6(usdToGmxUsd(12.345678))).toBe(12_345_678n);
  });
  it("lifts 6dp to 1e30", () => {
    expect(usdc6ToGmxUsd(15_000_000n)).toBe(15n * E30);
  });
  it("round-trips", () => {
    expect(gmxUsdToUsdc6(usdc6ToGmxUsd(9_999_999n))).toBe(9_999_999n);
  });
});

describe("usdc 6dp helpers", () => {
  it("usdToUsdc6 / usdc6ToNumber", () => {
    expect(usdToUsdc6(15)).toBe(15_000_000n);
    expect(usdc6ToNumber(15_500_000n)).toBe(15.5);
  });
  it("collateral = |notional| / leverage", () => {
    expect(collateralUsdc6ForNotional(30, 2)).toBe(15_000_000n);
    expect(collateralUsdc6ForNotional(-30, 3)).toBe(10_000_000n);
  });
});

describe("acceptablePrice", () => {
  const P = 1_000n * E24; // some scaled price

  it("applySlippageBps up/down", () => {
    expect(applySlippageBps(10_000n, 150, "up")).toBe(10_150n);
    expect(applySlippageBps(10_000n, 150, "down")).toBe(9_850n);
  });

  it("buy-side bounds up, sell-side bounds down", () => {
    // increase long = buy -> up; increase short = sell -> down
    expect(acceptablePriceSide("increase", true)).toBe("up");
    expect(acceptablePriceSide("increase", false)).toBe("down");
    // decrease long = sell -> down; decrease short = buy -> up
    expect(acceptablePriceSide("decrease", true)).toBe("down");
    expect(acceptablePriceSide("decrease", false)).toBe("up");
  });

  it("opening a long accepts a higher price", () => {
    expect(acceptablePrice(P, "increase", true, 150)).toBeGreaterThan(P);
  });
  it("opening a short accepts a lower price", () => {
    expect(acceptablePrice(P, "increase", false, 150)).toBeLessThan(P);
  });
});

describe("parseUsdc6", () => {
  it("parses integers and decimals, truncating beyond 6dp", () => {
    expect(parseUsdc6("16")).toBe(16_000_000n);
    expect(parseUsdc6("16.01")).toBe(16_010_000n);
    expect(parseUsdc6("0.0000019")).toBe(1n); // truncated, not rounded
  });
  it("rejects negatives and garbage", () => {
    expect(() => parseUsdc6("-1")).toThrow();
    expect(() => parseUsdc6("abc")).toThrow();
  });
});
