// The contract for the backend GET /status payload — consumed by the web front.
// Single source of truth so backend and web never drift.
export interface StatusPosition {
  symbol: string;
  isLong: boolean;
  sizeUsd: number; // signed notional magnitude
  netValueUsd: number; // collateral - fees + uPnL
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
  pushed: boolean;
  settled: { deposit: boolean; redeem: boolean };
  lastTradeAt: number;
  lastTradeOk: boolean;
}
