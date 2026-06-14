import type { GmxSdk } from "@gmx-io/sdk";
import type { MarketsInfoData } from "@gmx-io/sdk/types/markets";
import type { TokensData } from "@gmx-io/sdk/types/tokens";
import type { PositionInfo } from "@gmx-io/sdk/types/positions";
import { withRetry } from "../util/retry.js";
import { gmxUsdToNumber } from "./converters.js";

export interface SignedPosition {
  symbol: string;
  isLong: boolean;
  signedNotionalUsd: number; // + long, - short, from sizeInUsd
  netValueUsd: number; // collateral - pending fees + PnL — feeds NAV
  position: PositionInfo;
}

// GMX's on-chain minimum collateral per position (USD), from DataStore via the SDK.
// Returns null if the read fails (caller uses a fallback floor).
export async function getMinCollateralUsd(sdk: GmxSdk): Promise<number | null> {
  try {
    const c = await sdk.positions.getPositionsConstants();
    return c.minCollateralUsd != null ? gmxUsdToNumber(c.minCollateralUsd) : null;
  } catch {
    return null;
  }
}

// Read the hot account's open positions. Requires sdk.account to be set.
export async function getOpenPositions(
  sdk: GmxSdk,
  marketsInfoData: MarketsInfoData,
  tokensData: TokensData,
): Promise<PositionInfo[]> {
  const data = await withRetry(() =>
    sdk.positions.getPositionsInfo({ marketsInfoData, tokensData, showPnlInLeverage: false }),
  );
  return Object.values(data);
}

function symbolOf(p: PositionInfo): string {
  return p.indexToken?.symbol ?? p.marketInfo?.indexToken?.symbol ?? "?";
}

export function toSignedPositions(positions: PositionInfo[]): SignedPosition[] {
  return positions.map((p) => {
    const sizeUsd = gmxUsdToNumber(p.sizeInUsd);
    return {
      symbol: symbolOf(p),
      isLong: p.isLong,
      signedNotionalUsd: p.isLong ? sizeUsd : -sizeUsd,
      netValueUsd: gmxUsdToNumber(p.netValue),
      position: p,
    };
  });
}

// Net signed notional per symbol (long positive, short negative), summed across
// any same-symbol positions.
export function signedNotionalBySymbol(positions: SignedPosition[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of positions) {
    m.set(p.symbol, (m.get(p.symbol) ?? 0) + p.signedNotionalUsd);
  }
  return m;
}
