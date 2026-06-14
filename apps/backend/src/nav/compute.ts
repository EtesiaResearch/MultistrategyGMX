import type { GmxSdk } from "@gmx-io/sdk";
import { OrderType } from "@gmx-io/sdk/types/orders";
import type { Logger } from "pino";
import type { Address, PublicClient } from "viem";
import { usdcAbi } from "../abi/usdc.js";
import { gmxUsdToNumber } from "../gmx/converters.js";
import type { MarketsBundle } from "../gmx/markets.js";
import { getOpenPositions } from "../gmx/positions.js";
import { assembleNav, type NavBreakdown } from "./assemble.js";

export interface ComputeNavDeps {
  sdk: GmxSdk;
  publicClient: PublicClient;
  bundle: MarketsBundle;
  account: Address;
  usdc: Address;
  logger?: Logger;
}

export interface NavResult extends NavBreakdown {
  positionComponents: { symbol: string; isLong: boolean; netValueUsd: number; sizeUsd: number }[];
  pendingIncreaseCount: number;
}

export async function computeNav(deps: ComputeNavDeps): Promise<NavResult> {
  const { sdk, publicClient, bundle, account, usdc } = deps;
  const usdcLower = usdc.toLowerCase();

  const [idleUsdc6, positions, ordersRes] = await Promise.all([
    publicClient.readContract({
      address: usdc,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [account],
    }),
    getOpenPositions(sdk, bundle.marketsInfoData, bundle.tokensData),
    sdk.orders.getOrders({
      marketsInfoData: bundle.marketsInfoData,
      tokensData: bundle.tokensData,
    }),
  ]);

  // Collateral locked in not-yet-executed increase orders (USDC in the OrderVault).
  const pendingIncrease = Object.values(ordersRes.ordersInfoData ?? {}).filter(
    (o) =>
      o.orderType === OrderType.MarketIncrease &&
      o.initialCollateralTokenAddress.toLowerCase() === usdcLower,
  );

  const breakdown = assembleNav({
    idleUsdc6,
    positionNetValues1e30: positions.map((p) => p.netValue),
    pendingIncreaseCollateral6: pendingIncrease.map((o) => o.initialCollateralDeltaAmount),
  });

  const result: NavResult = {
    ...breakdown,
    pendingIncreaseCount: pendingIncrease.length,
    positionComponents: positions.map((p) => ({
      symbol: p.indexToken?.symbol ?? "?",
      isLong: p.isLong,
      netValueUsd: gmxUsdToNumber(p.netValue),
      sizeUsd: gmxUsdToNumber(p.sizeInUsd),
    })),
  };

  deps.logger?.info(
    {
      navUsdc6: result.navUsdc6.toString(),
      idleUsdc6: result.idleUsdc6.toString(),
      positionsNetUsd6: result.positionsNetUsd6.toString(),
      pendingCollateralUsd6: result.pendingCollateralUsd6.toString(),
      pendingIncreaseCount: result.pendingIncreaseCount,
      positions: result.positionComponents,
    },
    "computed GMX-aware NAV",
  );

  return result;
}
