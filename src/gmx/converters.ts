// GMX decimal conventions — the single biggest source of silent bugs, so every
// conversion lives here and is unit-tested.
//
//   USD values (sizeDeltaUsd, prices-as-usd, pnl): 30 decimals (1e30).
//   Token amounts: native decimals (USDC = 6, WETH = 18).
//   A token PRICE is stored scaled as: realPrice * 10^(30 - tokenDecimals).
//   The tickers API returns minPrice/maxPrice already in that scaled form.
//   Lagoon's newTotalAssets is in the asset's decimals (USDC = 6).

export const USD_DECIMALS = 30n;
export const USDC_DECIMALS = 6n;

const TEN = 10n;
const USD_TO_USDC6 = TEN ** (USD_DECIMALS - USDC_DECIMALS); // 10^24
const MICRO = 1_000_000; // 1e6 — 6 sig. decimals when bridging float USD <-> bigint

/** USD float (e.g. 15.5) -> GMX 1e30 bigint, preserving 6 decimals of precision. */
export function usdToGmxUsd(usd: number): bigint {
  if (!Number.isFinite(usd)) throw new Error(`usdToGmxUsd: non-finite ${usd}`);
  const micro = BigInt(Math.round(usd * MICRO)); // micro-USD as integer
  return micro * USD_TO_USDC6;
}

/** GMX 1e30 bigint -> USD float (for logs/display only; not for onchain math). */
export function gmxUsdToNumber(x: bigint): number {
  // Divide to micro-USD first so the Number() fits comfortably for sane values.
  return Number(x / USD_TO_USDC6) / MICRO;
}

/** GMX 1e30 USD bigint -> USDC 6dp bigint (floor). Used when pushing NAV to Lagoon. */
export function gmxUsdToUsdc6(x: bigint): bigint {
  return x / USD_TO_USDC6;
}

/** USDC 6dp bigint -> GMX 1e30 USD bigint. */
export function usdc6ToGmxUsd(x: bigint): bigint {
  return x * USD_TO_USDC6;
}

/** USD float -> USDC 6dp bigint (e.g. collateral amount to send). */
export function usdToUsdc6(usd: number): bigint {
  if (!Number.isFinite(usd)) throw new Error(`usdToUsdc6: non-finite ${usd}`);
  return BigInt(Math.round(usd * MICRO));
}

/** USDC 6dp bigint -> USD float (display). */
export function usdc6ToNumber(x: bigint): number {
  return Number(x) / MICRO;
}

/**
 * Collateral (USDC 6dp) needed to back a target notional at a fixed leverage.
 * Isolated margin: collateral = |notional| / leverage.
 */
export function collateralUsdc6ForNotional(notionalUsd: number, leverage: number): bigint {
  if (leverage <= 0) throw new Error(`leverage must be > 0, got ${leverage}`);
  return usdToUsdc6(Math.abs(notionalUsd) / leverage);
}

/** Apply +/- slippage (bps) to a scaled bigint price. */
export function applySlippageBps(price: bigint, bps: number, side: "up" | "down"): bigint {
  const b = BigInt(Math.round(bps));
  const DENOM = 10_000n;
  return side === "up" ? (price * (DENOM + b)) / DENOM : (price * (DENOM - b)) / DENOM;
}

/**
 * Whether an order is effectively a BUY (bound acceptablePrice UP) or SELL (bound DOWN).
 *   increase + long  -> buy        increase + short -> sell
 *   decrease + long  -> sell       decrease + short -> buy
 */
export function acceptablePriceSide(
  kind: "increase" | "decrease",
  isLong: boolean,
): "up" | "down" {
  const isBuy = kind === "increase" ? isLong : !isLong;
  return isBuy ? "up" : "down";
}

/** Tolerant acceptablePrice for a market order, given the scaled oracle price. */
export function acceptablePrice(
  oraclePriceScaled: bigint,
  kind: "increase" | "decrease",
  isLong: boolean,
  slippageBps: number,
): bigint {
  return applySlippageBps(oraclePriceScaled, slippageBps, acceptablePriceSide(kind, isLong));
}

/**
 * Parse a decimal USDC string ("16.01") -> 6dp bigint, truncating beyond 6 decimals.
 * Ported from etesia-curator/src/nav/compute.ts. Rejects negatives.
 */
export function parseUsdc6(s: string): bigint {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) throw new Error(`parseUsdc6: bad number "${s}"`);
  const parts = s.split(".");
  const intPart = parts[0] ?? "0";
  const frac6 = ((parts[1] ?? "") + "000000").slice(0, 6);
  return BigInt(intPart) * 1_000_000n + BigInt(frac6);
}
