import type { PositionInfo } from "@gmx-io/sdk/types/positions";
import type { Target } from "../signal/types.js";
import {
  awaitOrdersCleared,
  decreasePosition,
  increasePosition,
  type ExecutorDeps,
  type OrderOutcome,
} from "./executor.js";
import type { MarketsBundle } from "./markets.js";
import { planReconcile, positionsBySymbol, type ReconcileStep } from "./reconcile.js";

// Execute a plan: run steps in order, awaiting keeper execution between steps so a
// flip's close lands before its open, and so notional reads are fresh next cycle.
export async function runReconcile(
  deps: ExecutorDeps,
  bundle: MarketsBundle,
  targets: Target[],
  positions: PositionInfo[],
): Promise<{ steps: ReconcileStep[]; outcomes: OrderOutcome[]; scale: number }> {
  const { steps, scale, totalTargetUsd } = planReconcile(targets, positionsBySymbol(positions), {
    minOrderUsd: deps.cfg.MIN_ORDER_USD,
    maxTotalNotionalUsd: deps.cfg.MAX_TOTAL_NOTIONAL_USD,
  });

  deps.logger.info(
    { steps: steps.length, scale, totalTargetUsd, dryRun: deps.cfg.DRY_RUN },
    "reconcile plan",
  );

  const outcomes: OrderOutcome[] = [];
  for (const step of steps) {
    const outcome =
      step.type === "increase"
        ? await increasePosition(deps, bundle, {
            symbol: step.symbol,
            isLong: step.isLong,
            notionalUsd: step.notionalUsd,
          })
        : await decreasePosition(deps, bundle, {
            position: step.position,
            closeNotionalUsd: step.closeNotionalUsd,
            fullClose: step.fullClose,
          });
    outcomes.push(outcome);
    // Only wait on the keeper when we actually broadcast something.
    if (outcome.submitted) await awaitOrdersCleared(deps, bundle);
  }
  return { steps, outcomes, scale };
}
