import type { GmxSdk } from "@gmx-io/sdk";
import type { MarketsInfoData, MarketInfo } from "@gmx-io/sdk/types/markets";
import type { TokensData } from "@gmx-io/sdk/types/tokens";
import type { Logger } from "pino";

export interface MarketsBundle {
  marketsInfoData: MarketsInfoData;
  tokensData: TokensData;
  // index-token symbol (e.g. "ETH", "BTC", "SOL") -> the chosen perp MarketInfo.
  bySymbol: Map<string, MarketInfo>;
}

// Native USDC on Arbitrum — we want USDC-collateralized perp markets.
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831".toLowerCase();

function isUsdcShort(m: MarketInfo): boolean {
  return m.shortToken?.address?.toLowerCase() === USDC;
}

// Pick the canonical perp market for a symbol: tradable, dual-collateral, USDC-short.
function preferMarket(current: MarketInfo | undefined, candidate: MarketInfo): MarketInfo {
  if (!current) return candidate;
  const curScore = (isUsdcShort(current) ? 2 : 0) + (current.isSameCollaterals ? 0 : 1);
  const candScore = (isUsdcShort(candidate) ? 2 : 0) + (candidate.isSameCollaterals ? 0 : 1);
  return candScore > curScore ? candidate : current;
}

export async function loadMarkets(sdk: GmxSdk, logger?: Logger): Promise<MarketsBundle> {
  const { marketsInfoData, tokensData } = await sdk.markets.getMarketsInfo();
  if (!marketsInfoData || !tokensData) {
    throw new Error("getMarketsInfo returned no marketsInfoData/tokensData");
  }
  const bySymbol = new Map<string, MarketInfo>();
  for (const market of Object.values(marketsInfoData)) {
    if (market.isSpotOnly || market.isDisabled) continue;
    const symbol = market.indexToken?.symbol;
    if (!symbol) continue;
    bySymbol.set(symbol, preferMarket(bySymbol.get(symbol), market));
  }
  logger?.info({ markets: bySymbol.size, symbols: [...bySymbol.keys()] }, "loaded GMX markets");
  return { marketsInfoData, tokensData, bySymbol };
}

export function getMarket(bundle: MarketsBundle, symbol: string): MarketInfo | undefined {
  return bundle.bySymbol.get(symbol);
}
