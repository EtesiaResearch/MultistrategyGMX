import type { GmxSdk } from "@gmx-io/sdk";
import { getDecreasePositionAmounts } from "@gmx-io/sdk/utils/trade";
import type { PositionInfo, PositionInfoLoaded } from "@gmx-io/sdk/types/positions";
import type { Logger } from "pino";
import { canBroadcast, type Config } from "../config.js";
import { collateralUsdc6ForNotional, usdToGmxUsd } from "./converters.js";
import type { MarketsBundle } from "./markets.js";
import { getMarket } from "./markets.js";

export interface ExecutorDeps {
  sdk: GmxSdk;
  cfg: Config;
  logger: Logger;
}

export interface OrderOutcome {
  kind: "increase" | "decrease";
  symbol: string;
  isLong: boolean;
  sizeDeltaUsd: number; // absolute notional change requested
  dryRun: boolean;
  submitted: boolean;
  error?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Open a new position or increase an existing one by `notionalUsd` of size, sized
// at the configured leverage (collateral = notional / leverage), paying in USDC.
export async function increasePosition(
  deps: ExecutorDeps,
  bundle: MarketsBundle,
  args: { symbol: string; isLong: boolean; notionalUsd: number; minCollateralUsd?: number | null },
): Promise<OrderOutcome> {
  const { sdk, cfg, logger } = deps;
  const market = getMarket(bundle, args.symbol);
  const base: OrderOutcome = {
    kind: "increase",
    symbol: args.symbol,
    isLong: args.isLong,
    sizeDeltaUsd: Math.abs(args.notionalUsd),
    dryRun: !canBroadcast(cfg),
    submitted: false,
  };
  if (!market) return { ...base, error: `no GMX market for ${args.symbol}` };

  // Per-leg revert guard (NOT book-thinning): skip only if THIS order's collateral would
  // fall below GMX's on-chain MIN_COLLATERAL_USD — it would revert + burn gas. The reconcile
  // floor keeps legs above this, so at a healthy NAV this never fires; log loudly if it does.
  const collateralUsd = Math.abs(args.notionalUsd) / cfg.TARGET_LEVERAGE;
  if (args.minCollateralUsd != null && collateralUsd < args.minCollateralUsd) {
    logger.warn(
      { symbol: args.symbol, collateralUsd, minCollateralUsd: args.minCollateralUsd, notionalUsd: base.sizeDeltaUsd },
      "leg below GMX min collateral — skipping this leg (would revert). Add capital to place it.",
    );
    return { ...base, error: "below GMX min collateral" };
  }

  const collateralUsdc6 = collateralUsdc6ForNotional(args.notionalUsd, cfg.TARGET_LEVERAGE);
  const leverageBps = BigInt(Math.round(cfg.TARGET_LEVERAGE * 10_000));

  logger.info(
    {
      symbol: args.symbol,
      isLong: args.isLong,
      notionalUsd: base.sizeDeltaUsd,
      collateralUsdc6: collateralUsdc6.toString(),
      leverageBps: leverageBps.toString(),
      market: market.marketTokenAddress,
    },
    base.dryRun ? "DRY_RUN increase (not broadcast)" : "submitting increase order",
  );
  if (base.dryRun) return base;

  try {
    const params = {
      payAmount: collateralUsdc6,
      marketAddress: market.marketTokenAddress,
      payTokenAddress: cfg.USDC_ADDRESS,
      collateralTokenAddress: cfg.USDC_ADDRESS,
      allowedSlippageBps: cfg.ACCEPTABLE_PRICE_SLIPPAGE_BPS,
      leverage: leverageBps,
      marketsInfoData: bundle.marketsInfoData,
      tokensData: bundle.tokensData,
    };
    await (args.isLong ? sdk.orders.long(params) : sdk.orders.short(params));
    return { ...base, submitted: true };
  } catch (err) {
    logger.error({ err, symbol: args.symbol }, "increase order failed");
    return { ...base, error: String(err) };
  }
}

// Reduce or fully close an existing position by `closeNotionalUsd` of size.
export async function decreasePosition(
  deps: ExecutorDeps,
  bundle: MarketsBundle,
  args: { position: PositionInfo; closeNotionalUsd: number; fullClose: boolean },
): Promise<OrderOutcome> {
  const { sdk, cfg, logger } = deps;
  const { position } = args;
  const symbol = position.indexToken?.symbol ?? "?";
  const base: OrderOutcome = {
    kind: "decrease",
    symbol,
    isLong: position.isLong,
    sizeDeltaUsd: Math.abs(args.closeNotionalUsd),
    dryRun: !canBroadcast(cfg),
    submitted: false,
  };
  const marketInfo = position.marketInfo;
  if (!marketInfo) return { ...base, error: `position has no marketInfo for ${symbol}` };

  const closeSizeUsd = args.fullClose
    ? position.sizeInUsd
    : usdToGmxUsd(Math.abs(args.closeNotionalUsd));

  logger.info(
    {
      symbol,
      isLong: position.isLong,
      closeNotionalUsd: base.sizeDeltaUsd,
      fullClose: args.fullClose,
      market: marketInfo.marketTokenAddress,
    },
    base.dryRun ? "DRY_RUN decrease (not broadcast)" : "submitting decrease order",
  );
  if (base.dryRun) return base;

  try {
    const [constants, uiFeeFactor] = await Promise.all([
      sdk.positions.getPositionsConstants(),
      sdk.utils.getUiFeeFactor(),
    ]);
    const minCollateralUsd = constants.minCollateralUsd ?? 0n;
    const minPositionSizeUsd = constants.minPositionSizeUsd ?? 0n;

    const decreaseAmounts = getDecreasePositionAmounts({
      marketInfo,
      collateralToken: position.collateralToken,
      isLong: position.isLong,
      position: position as PositionInfoLoaded,
      closeSizeUsd,
      keepLeverage: false,
      userReferralInfo: undefined,
      minCollateralUsd,
      minPositionSizeUsd,
      uiFeeFactor,
      isSetAcceptablePriceImpactEnabled: false,
    });

    await sdk.orders.createDecreaseOrder({
      marketsInfoData: bundle.marketsInfoData,
      tokensData: bundle.tokensData,
      marketInfo,
      decreaseAmounts,
      collateralToken: position.collateralToken,
      allowedSlippage: cfg.ACCEPTABLE_PRICE_SLIPPAGE_BPS,
      isLong: position.isLong,
      isTrigger: false,
    });
    return { ...base, submitted: true };
  } catch (err) {
    logger.error({ err, symbol }, "decrease order failed");
    return { ...base, error: String(err) };
  }
}

// Poll until the account has no pending orders (keeper executed everything), or timeout.
// GMX orders are async: createOrder returns before the keeper fills with an oracle price.
export async function awaitOrdersCleared(
  deps: ExecutorDeps,
  bundle: MarketsBundle,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ cleared: boolean; pending: number }> {
  const { sdk, logger } = deps;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 4_000;
  const deadline = performance.now() + timeoutMs;

  for (;;) {
    const { count } = await sdk.orders.getOrders({
      marketsInfoData: bundle.marketsInfoData,
      tokensData: bundle.tokensData,
    });
    if (count === 0) return { cleared: true, pending: 0 };
    if (performance.now() >= deadline) {
      logger.warn({ pending: count }, "awaitOrdersCleared timed out with pending orders");
      return { cleared: false, pending: count };
    }
    await sleep(intervalMs);
  }
}
