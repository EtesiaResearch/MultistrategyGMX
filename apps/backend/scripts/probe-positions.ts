// Diagnose the intermittent empty position reads. Loads markets + reads positions
// several ways, several times. Read-only. Run from apps/backend: pnpm tsx scripts/probe-positions.ts
import { pino } from "pino";
import { loadConfig } from "../src/config.js";
import { makeGmxSdk } from "../src/gmx/sdk.js";
import { loadMarkets } from "../src/gmx/markets.js";

const logger = pino({ transport: { target: "pino-pretty" } });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const sdk = makeGmxSdk(cfg);
  logger.info({ account: sdk.account }, "sdk account");

  for (let i = 0; i < 5; i++) {
    const bundle = await loadMarkets(sdk);
    const ethMarket = bundle.bySymbol.get("ETH");
    const ethPrice = ethMarket?.indexToken?.prices?.maxPrice;
    const info = await sdk.positions.getPositionsInfo({
      marketsInfoData: bundle.marketsInfoData,
      tokensData: bundle.tokensData,
      showPnlInLeverage: false,
    });
    const raw = await sdk.positions.getPositions({
      marketsData: bundle.marketsInfoData,
      tokensData: bundle.tokensData,
    });
    logger.info(
      {
        i,
        marketsCount: Object.keys(bundle.marketsInfoData).length,
        ethHasPrice: ethPrice !== undefined && ethPrice > 0n,
        infoCount: Object.keys(info).length,
        rawCount: Object.keys(raw.positionsData ?? {}).length,
        rawError: raw.error?.message ?? null,
      },
      "read",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
