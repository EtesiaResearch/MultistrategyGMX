// Pure reconciliation planner — NO SDK runtime imports, so it stays unit-testable
// (the SDK's executor runtime uses extensionless ESM that only tsx tolerates).
// The effectful executor lives in run-reconcile.ts.
import type { PositionInfo } from "@gmx-io/sdk/types/positions";
import type { Target } from "../signal/types.js";
import { gmxUsdToNumber } from "./converters.js";

// A single executor action. A sign flip expands to a decrease (close) followed by
// an increase on the other side; the decrease must execute (keeper) before the
// increase, so steps are ordered and run sequentially.
export type ReconcileStep =
  | { type: "increase"; symbol: string; isLong: boolean; notionalUsd: number; reason: string }
  | {
      type: "decrease";
      symbol: string;
      position: PositionInfo;
      closeNotionalUsd: number;
      fullClose: boolean;
      reason: string;
    };

export interface ReconcileConfig {
  minOrderUsd: number;
  maxTotalNotionalUsd: number;
  // present only so flip ordering is explicit; sizing uses leverage in the executor.
}

function signedNotional(p: PositionInfo): number {
  const size = gmxUsdToNumber(p.sizeInUsd);
  return p.isLong ? size : -size;
}

// Pure planner: diff desired targets against current positions, emitting ordered steps.
export function planReconcile(
  targets: Target[],
  positionsBySymbol: Map<string, PositionInfo>,
  cfg: ReconcileConfig,
): { steps: ReconcileStep[]; scale: number; totalTargetUsd: number } {
  const targetMap = new Map<string, number>();
  for (const t of targets) targetMap.set(t.symbol, (targetMap.get(t.symbol) ?? 0) + t.signedNotionalUsd);

  // Cap gross exposure: scale all targets down proportionally if they breach the cap.
  const totalTargetUsd = [...targetMap.values()].reduce((s, v) => s + Math.abs(v), 0);
  const scale =
    totalTargetUsd > cfg.maxTotalNotionalUsd && totalTargetUsd > 0
      ? cfg.maxTotalNotionalUsd / totalTargetUsd
      : 1;

  const symbols = new Set<string>([...targetMap.keys(), ...positionsBySymbol.keys()]);
  const steps: ReconcileStep[] = [];

  for (const symbol of symbols) {
    const target = (targetMap.get(symbol) ?? 0) * scale;
    const pos = positionsBySymbol.get(symbol);
    const current = pos ? signedNotional(pos) : 0;
    const delta = target - current;
    if (Math.abs(delta) < cfg.minOrderUsd) continue;

    const flip = current !== 0 && target !== 0 && Math.sign(target) !== Math.sign(current);

    if (flip && pos) {
      steps.push({
        type: "decrease",
        symbol,
        position: pos,
        closeNotionalUsd: Math.abs(current),
        fullClose: true,
        reason: `flip ${current.toFixed(2)} -> ${target.toFixed(2)}`,
      });
      steps.push({
        type: "increase",
        symbol,
        isLong: target > 0,
        notionalUsd: Math.abs(target),
        reason: `flip open ${target.toFixed(2)}`,
      });
    } else if (target === 0 && pos) {
      steps.push({
        type: "decrease",
        symbol,
        position: pos,
        closeNotionalUsd: Math.abs(current),
        fullClose: true,
        reason: `flatten ${current.toFixed(2)}`,
      });
    } else if (current === 0) {
      steps.push({
        type: "increase",
        symbol,
        isLong: target > 0,
        notionalUsd: Math.abs(target),
        reason: `open ${target.toFixed(2)}`,
      });
    } else if (Math.abs(target) > Math.abs(current)) {
      steps.push({
        type: "increase",
        symbol,
        isLong: target > 0,
        notionalUsd: Math.abs(delta),
        reason: `grow ${current.toFixed(2)} -> ${target.toFixed(2)}`,
      });
    } else if (pos) {
      steps.push({
        type: "decrease",
        symbol,
        position: pos,
        closeNotionalUsd: Math.abs(delta),
        fullClose: false,
        reason: `trim ${current.toFixed(2)} -> ${target.toFixed(2)}`,
      });
    }
  }

  return { steps, scale, totalTargetUsd };
}

// Build a symbol -> position map (assumes our bot holds at most one side per symbol).
export function positionsBySymbol(positions: PositionInfo[]): Map<string, PositionInfo> {
  const m = new Map<string, PositionInfo>();
  for (const p of positions) {
    const sym = p.indexToken?.symbol;
    if (sym) m.set(sym, p);
  }
  return m;
}
