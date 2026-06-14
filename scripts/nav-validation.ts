// Empirical NAV validation (Nadar standing rule). Requires a FUNDED EOA + DRY_RUN=false.
// Proves the NAV formula against live onchain behaviour before we trust it:
//   1. snapshot NAV
//   2. open a tiny ETH long with known collateral C; after keeper exec assert
//      ΔNAV ≈ -openFees (capital moved internally, not lost) and position net ≈ C - fees
//   3. close; assert NAV ≈ start - roundtrip fees
// Logs the measured deltas/ratios — do not trust the formula until these line up.
//
// Run: DRY_RUN=false HOT_PK=0x... pnpm tsx scripts/nav-validation.ts
import { pino } from "pino";
import { canBroadcast, loadConfig } from "../src/config.js";
import { makeAccount, makePublicClient } from "../src/clients.js";
import { makeGmxSdk } from "../src/gmx/sdk.js";
import { loadMarkets } from "../src/gmx/markets.js";
import { computeNav } from "../src/nav/compute.js";
import { getOpenPositions } from "../src/gmx/positions.js";
import { increasePosition, decreasePosition, awaitOrdersCleared } from "../src/gmx/executor.js";
import { usdc6ToNumber } from "../src/gmx/converters.js";
import type { Address } from "viem";

const logger = pino({ transport: { target: "pino-pretty" } });
const SYMBOL = "ETH";
const NOTIONAL_USD = 15;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const account = makeAccount(cfg);
  if (!account || !canBroadcast(cfg)) {
    throw new Error("nav-validation needs a funded HOT_PK and DRY_RUN=false");
  }
  const sdk = makeGmxSdk(cfg);
  const publicClient = makePublicClient(cfg);
  const deps = { sdk, cfg, logger };
  const navOf = async (label: string): Promise<number> => {
    const bundle = await loadMarkets(sdk);
    const nav = await computeNav({ sdk, publicClient, bundle, account: account.address as Address, usdc: cfg.USDC_ADDRESS as Address });
    const usd = usdc6ToNumber(nav.navUsdc6);
    logger.info({ label, navUsd: usd, idle: usdc6ToNumber(nav.idleUsdc6), positions: nav.positionComponents }, "NAV snapshot");
    return usd;
  };

  const start = await navOf("start");

  // 1) open
  const bundle = await loadMarkets(sdk);
  await increasePosition(deps, bundle, { symbol: SYMBOL, isLong: true, notionalUsd: NOTIONAL_USD });
  await awaitOrdersCleared(deps, bundle);
  const afterOpen = await navOf("after-open");
  logger.info(
    { deltaNavUsd: afterOpen - start, note: "expect ≈ -openFees (capital moved into position, not lost)" },
    "OPEN check",
  );

  // 2) position net value
  const positions = await getOpenPositions(sdk, bundle.marketsInfoData, bundle.tokensData);
  for (const p of positions) {
    logger.info({ symbol: p.indexToken?.symbol, isLong: p.isLong }, "open position present");
  }

  // 3) close
  const bundle2 = await loadMarkets(sdk);
  const pos = (await getOpenPositions(sdk, bundle2.marketsInfoData, bundle2.tokensData)).find(
    (p) => p.indexToken?.symbol === SYMBOL,
  );
  if (pos) {
    await decreasePosition(deps, bundle2, { position: pos, closeNotionalUsd: NOTIONAL_USD, fullClose: true });
    await awaitOrdersCleared(deps, bundle2);
  }
  const afterClose = await navOf("after-close");
  logger.info(
    {
      roundtripCostUsd: start - afterClose,
      note: "expect small positive (open+close fees + funding); NAV returns to ~idle",
    },
    "CLOSE check",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
