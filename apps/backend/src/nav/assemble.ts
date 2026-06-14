import { gmxUsdToUsdc6 } from "../gmx/converters.js";

// GMX-aware NAV, expressed in USDC 6dp (Lagoon's asset units).
//
//   NAV = idleUSDC(EOA)
//       + Σ position netValue           (collateral - pending fees + uPnL, from Reader)
//       + Σ pending-increase collateral (USDC sitting in OrderVault, not yet a position)
//
// Pending-order collateral is the #1 async-NAV bug: an increase order moves USDC out
// of the EOA into the OrderVault before the keeper turns it into a position, so it must
// be added back exactly once or NAV dips by the collateral mid-flight.
export interface NavBreakdown {
  idleUsdc6: bigint;
  positionsNetUsd6: bigint;
  pendingCollateralUsd6: bigint;
  navUsdc6: bigint;
}

export function assembleNav(parts: {
  idleUsdc6: bigint;
  positionNetValues1e30: bigint[];
  pendingIncreaseCollateral6: bigint[];
}): NavBreakdown {
  const positionsNetUsd6 = parts.positionNetValues1e30.reduce(
    (sum, v) => sum + gmxUsdToUsdc6(v),
    0n,
  );
  const pendingCollateralUsd6 = parts.pendingIncreaseCollateral6.reduce((sum, v) => sum + v, 0n);
  const raw = parts.idleUsdc6 + positionsNetUsd6 + pendingCollateralUsd6;
  // Floor at 0 — a vault can't be worth less than nothing to LPs. Isolated GMX
  // positions can't go below 0 net value (liquidation closes first), so this is a guard.
  const navUsdc6 = raw < 0n ? 0n : raw;
  return { idleUsdc6: parts.idleUsdc6, positionsNetUsd6, pendingCollateralUsd6, navUsdc6 };
}
