import type { GmxSdk } from "@gmx-io/sdk";
import type { Logger } from "pino";
import type { Address, PublicClient } from "viem";
import type { Config } from "../config.js";
import { getOpenPositions } from "../gmx/positions.js";
import { getAccountPositionsOnchain } from "../gmx/reader-positions.js";
import { runReconcile } from "../gmx/run-reconcile.js";
import { loadMarkets } from "../gmx/markets.js";
import type { SignalSource } from "../signal/index.js";

export interface TradeCycleDeps {
  sdk: GmxSdk;
  cfg: Config;
  logger: Logger;
  publicClient: PublicClient;
  signalSource: SignalSource;
  hasAccount: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// One trade cycle: pull targets -> drop symbols GMX can't trade -> diff vs current
// positions -> reconcile (DRY_RUN logs the plan; live broadcasts + awaits keeper).
// Markets are fetched fresh each cycle so position valuation uses live oracle prices.
export async function tradeCycle(deps: TradeCycleDeps): Promise<void> {
  const { sdk, cfg, logger, signalSource } = deps;
  const bundle = await loadMarkets(sdk);

  // Tell the source which symbols GMX can trade, so the dynamic mirror scales over only
  // those (an untradable leg must not shrink the rest below the order floor).
  const supportedSymbols = new Set(bundle.bySymbol.keys());
  const targets = await signalSource.getTargets({ supportedSymbols });
  const supported = targets.filter((t) => bundle.bySymbol.has(t.symbol));
  const dropped = targets.filter((t) => !bundle.bySymbol.has(t.symbol)).map((t) => t.symbol);
  if (dropped.length) logger.info({ dropped }, "trade-cycle: dropped symbols with no GMX market");

  // Positions, cross-checked against the on-chain Reader ground truth. The SDK's
  // getPositionsInfo can silently drop a position on incomplete price data; acting on
  // that partial view would re-open a duplicate (mock) or miss a close (flat). So we
  // ask the Reader how many positions REALLY exist, and re-read the SDK (fresh markets)
  // until its count matches — never reconciling on a partial view.
  let positions = deps.hasAccount
    ? await getOpenPositions(sdk, bundle.marketsInfoData, bundle.tokensData)
    : [];
  if (deps.hasAccount) {
    const onchain = await getAccountPositionsOnchain(
      deps.publicClient,
      cfg.GMX_READER as Address,
      cfg.GMX_DATASTORE as Address,
      cfg.EXPECTED_EOA as Address,
    );
    for (let tries = 0; positions.length < onchain.length && tries < 3; tries++) {
      await sleep(200 * 2 ** tries);
      const reread = await loadMarkets(sdk);
      positions = await getOpenPositions(sdk, reread.marketsInfoData, reread.tokensData);
    }
    if (positions.length < onchain.length) {
      logger.warn(
        { sdkCount: positions.length, onchainCount: onchain.length },
        "trade-cycle: SDK positions below on-chain ground truth — skipping reconcile this cycle to avoid acting on a partial view",
      );
      return;
    }
  }

  const { steps, outcomes } = await runReconcile({ sdk, cfg, logger }, bundle, supported, positions);
  logger.info(
    {
      source: signalSource.name,
      targets: supported.length,
      steps: steps.length,
      submitted: outcomes.filter((o) => o.submitted).length,
      errors: outcomes.filter((o) => o.error).map((o) => `${o.symbol}:${o.error}`),
    },
    "trade-cycle done",
  );
}
