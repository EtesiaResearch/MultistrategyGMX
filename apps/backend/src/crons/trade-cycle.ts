import type { GmxSdk } from "@gmx-io/sdk";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import { getOpenPositions } from "../gmx/positions.js";
import { runReconcile } from "../gmx/run-reconcile.js";
import { loadMarkets } from "../gmx/markets.js";
import type { SignalSource } from "../signal/index.js";

export interface TradeCycleDeps {
  sdk: GmxSdk;
  cfg: Config;
  logger: Logger;
  signalSource: SignalSource;
  hasAccount: boolean;
}

// One trade cycle: pull targets -> drop symbols GMX can't trade -> diff vs current
// positions -> reconcile (DRY_RUN logs the plan; live broadcasts + awaits keeper).
// Markets are fetched fresh each cycle so position valuation uses live oracle prices.
export async function tradeCycle(deps: TradeCycleDeps): Promise<void> {
  const { sdk, cfg, logger, signalSource } = deps;
  const bundle = await loadMarkets(sdk);

  const targets = await signalSource.getTargets();
  const supported = targets.filter((t) => bundle.bySymbol.has(t.symbol));
  const dropped = targets.filter((t) => !bundle.bySymbol.has(t.symbol)).map((t) => t.symbol);
  if (dropped.length) logger.info({ dropped }, "trade-cycle: dropped symbols with no GMX market");

  // Reading positions needs sdk.account; in dry/no-key mode treat as flat.
  // Defensive re-read: the SDK's getPositionsInfo intermittently returns an empty
  // list (incomplete market/price data). An empty read on the close-critical path
  // would make us miss a position to flatten — or, with mock, re-open a duplicate.
  // So if the first read is empty, reload markets and read once more.
  let positions = deps.hasAccount
    ? await getOpenPositions(sdk, bundle.marketsInfoData, bundle.tokensData)
    : [];
  if (deps.hasAccount && positions.length === 0) {
    const retry = await loadMarkets(sdk);
    positions = await getOpenPositions(sdk, retry.marketsInfoData, retry.tokensData);
    if (positions.length > 0) logger.info({ count: positions.length }, "trade-cycle: positions found on re-read");
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
