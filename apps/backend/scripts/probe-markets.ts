// Read-only Arbitrum probe: prove SDK init + markets + oracle pricing work live
// (no funds, no signer needed). Run: pnpm tsx scripts/probe-markets.ts
import { pino } from "pino";
import { loadConfig } from "../src/config.js";
import { makeGmxSdk } from "../src/gmx/sdk.js";
import { loadMarkets } from "../src/gmx/markets.js";
import { gmxUsdToNumber } from "../src/gmx/converters.js";

const logger = pino({ transport: { target: "pino-pretty" } });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const sdk = makeGmxSdk(cfg);
  const bundle = await loadMarkets(sdk, logger);

  for (const sym of ["BTC", "ETH", "SOL"]) {
    const m = bundle.bySymbol.get(sym);
    if (!m) {
      logger.warn({ sym }, "no market");
      continue;
    }
    const maxPrice = m.indexToken?.prices?.maxPrice;
    logger.info(
      {
        sym,
        market: m.marketTokenAddress,
        long: m.longToken?.symbol,
        short: m.shortToken?.symbol,
        indexPriceUsd: maxPrice ? gmxUsdToNumber(maxPrice) : null,
      },
      "GMX market",
    );
  }
  logger.info({ totalSymbols: bundle.bySymbol.size }, "probe done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
