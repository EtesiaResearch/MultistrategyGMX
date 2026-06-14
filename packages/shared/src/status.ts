// The contract for the backend GET /status payload — consumed by the web front.
// Single source of truth so backend and web never drift.
export interface StatusPosition {
  symbol: string;
  isLong: boolean;
  sizeUsd: number; // position notional (USD)
  netValueUsd: number; // collateral - fees + uPnL
  entryPrice: number; // avg entry price (USD)
  markPrice: number; // current index price (USD)
  pnlUsd: number; // unrealized PnL (USD)
  roePct: number | null; // return on equity = pnl / collateral (null if no collateral)
  leverage: number | null; // e.g. 2 for 2x (null if unavailable)
}

export interface StatusNav {
  navUsd: number;
  idleUsd: number;
  positionsNetUsd: number;
  pendingCollateralUsd: number;
}

export interface StatusVaultState {
  totalAssetsUsd: number;
  totalSupply: string; // 18dp shares, as a string
  sharePrice: number | null; // totalAssets / totalSupply (null when supply is 0)
}

export interface StatusGas {
  ethBalance: number; // E's ETH balance (gas + GMX execution fees)
  low: boolean; // below GAS_MIN_ETH — the bot dies silently when gas runs out
}

// One historical sample, appended once per NAV cycle. Powers the web chart.
export interface HistorySample {
  t: number; // ms since epoch
  navUsd: number;
  sharePrice: number | null; // null while supply is 0
  positionsNetUsd: number;
  idleUsd: number;
}

export interface StatusResponse {
  chainId: number;
  vault: string | null;
  signer: string | null;
  signalSource: string;
  dryRun: boolean;
  updatedAt: number; // ms since epoch of the last NAV cycle
  nav: StatusNav | null;
  positions: StatusPosition[];
  vaultState: StatusVaultState | null;
  gas: StatusGas | null;
  pushed: boolean;
  settled: { deposit: boolean; redeem: boolean };
  lastTradeAt: number;
  lastTradeOk: boolean;
}
