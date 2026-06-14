# Etesia GMX — Data Flow

End-to-end map of every data flow in the system: external sources, the backend service
(executor + NAV oracle), the onchain contracts, the shared contract layer, and the web app.
Chain = **Arbitrum One (42161)**. Asset = **native USDC**.

---

## 0. The three planes (one picture)

```
        ┌─────────────────────────── EXTERNAL SOURCES ───────────────────────────┐
        │  Signals API            GMX V2 (Arbitrum)            Lagoon vault        │
        │  GET /api/positions     oracle + Reader + DataStore  (ERC-7540 + Silo)   │
        │  (target book)          + ExchangeRouter/OrderVault  asset = USDC        │
        └───────┬───────────────────────┬──────────────────────────┬─────────────┘
                │ collect signals        │ read prices/positions     │ read state / push NAV
                │                        │ write orders              │ settle
        ┌───────▼────────────────────────▼──────────────────────────▼─────────────┐
        │                    BACKEND  apps/backend  (one Node service, tsx)         │
        │   trade-cycle (TRADE_CRON)            nav-cycle (NAV_CRON)                 │
        │   signals → reconcile → GMX orders    NAV = idle+positions+pending →       │
        │     (signed by hot EOA "E")             pushNav + settleDeposit (E signs)  │
        │   HTTP: /healthz  /status  /history   (Fastify, CORS *)                    │
        └───────────────────────────────┬──────────────────────────────────────────┘
                                         │ GET /status (5s), /history
                                         │            + direct onchain reads (wagmi)
        ┌────────────────────────────────▼─────────────────────────────────────────┐
        │                       WEB  apps/web  (Next.js 15, Vercel)                  │
        │  cards + positions ← /status   chart ← Lagoon GraphQL                      │
        │  deposit/withdraw ← wagmi (vault + USDC, RPC)   wallet ← injected          │
        └───────────────────────────────────────────────────────────────────────────┘

        packages/shared  — single source of truth: chain, addresses, ABIs, StatusResponse type
```

Three actors onchain, all the **same hot EOA "E"** (`0xee94…b6A`): GMX trader + Lagoon
`valuationManager` + Lagoon `safe`/curator. Vault: `0x7f6c…5a2`.

---

## 1. External data sources

| Source | Endpoint / contract | Read or write | Used by |
|---|---|---|---|
| **Signals API** | `GET {SIGNALS_URL}/api/positions` → `[{instrumentKey, baseUnits, notionalUsd}]` | read (HTTP) | backend `signal/remote.ts` |
| **GMX oracle** (via `@gmx-io/sdk`) | tickers / `getMarketsInfo` (prices, markets, tokens) | read | backend `gmx/markets.ts` |
| **GMX SyntheticsReader** | `getAccountPositions(dataStore, account, …)` (raw positions, no prices) | read (viem) | backend `gmx/reader-positions.ts` |
| **GMX DataStore** | `MIN_COLLATERAL_USD`, positions constants (via SDK) | read | backend `gmx/positions.ts`, `executor.ts` |
| **GMX ExchangeRouter / OrderVault** | `multicall(sendWnt + sendTokens + createOrder)` | **write** | backend `gmx/executor.ts` (via SDK `orders.long/short`, `createDecreaseOrder`) |
| **GMX SyntheticsRouter** | USDC `approve` (one-time, `scripts/approve-usdc.ts`) | **write** | one-off go-live |
| **Lagoon vault** | `owner/safe/asset/totalAssets/totalSupply/valuationManager/getRolesStorage/pendingSilo/isTotalAssetsValid` | read | backend startup-check, nav-cycle; web `useVaultCore` |
| **Lagoon vault** | `updateNewTotalAssets`, `settleDeposit`, `settleRedeem` | **write** | backend `nav/push.ts`, `settle/execute.ts` |
| **Lagoon vault** | ERC-7540 `requestDeposit/syncDeposit/deposit/requestRedeem/redeem/claimSharesAndRequestRedeem` + `balanceOf/maxMint/pending*/claimable*/maxWithdraw` | read + **write** | web deposit/withdraw flows |
| **Lagoon GraphQL** | `api.lagoon.finance/query` — `vaultByAddress.stateHistory`, `transactions(RedeemRequest)` | read | web chart + withdraw countdown |
| **USDC (ERC-20)** | `balanceOf`, `allowance`, `approve`, `decimals` | read + write | backend NAV (E balance); web deposit |
| **Arbitrum RPC** (Alchemy) | JSON-RPC for all viem/SDK calls | read/write transport | backend (`ARBITRUM_RPC`); web (`NEXT_PUBLIC_ARBITRUM_RPC`) |

---

## 2. Backend — boot

`apps/backend/src/index.ts`:
1. **`loadConfig()`** (`config.ts`) — zod-validates env; address/numeric defaults pulled from
   `@etesia/shared`. Empty env values treated as unset.
2. **clients** (`clients.ts`) — viem `publicClient` + `walletClient` (from `HOT_PK`) on Arbitrum;
   `gmx/sdk.ts` builds `GmxSdk` (own RPC client, `setAccount(E)` even read-only).
3. **`runStartupCheck()`** (`startup-check.ts`) — reads vault `owner`/`safe` (== E), `asset` (== USDC),
   E's USDC + ETH; aborts boot on mismatch. `valuationManager` best-effort (older ABI).
4. **history store** (`history.ts`) — loads `HISTORY_PATH` ndjson into memory (ephemeral on Railway
   unless a volume is mounted).
5. Fastify listens; runs one `nav-cycle` + one `trade-cycle` immediately, then schedules both crons.

---

## 3. Backend — trade-cycle (`crons/trade-cycle.ts`)  [signals → GMX]

```
loadMarkets(sdk)                         → GMX getMarketsInfo (retry until complete) → bySymbol map
  │  supportedSymbols = bySymbol.keys()
signalSource.getTargets({supportedSymbols})
  │  RemoteSignalSource (signal/remote.ts):
  │    GET {SIGNALS_URL}/api/positions
  │    map instrumentKey → GMX symbol (PAXG→GOLD), drop XYZ_* RWA
  │    filter to supportedSymbols  (so untradable legs don't skew scaling)
  │    navProvider() → computeNav → NAV usd      (dynamic scale)
  │    normalizeTargets: Σ|notional| = NAV × MIRROR_GROSS_LEVERAGE   (signal/scale.ts)
  │  → Target[] = [{symbol, signedNotionalUsd}]
filter supported  (drop targets with no GMX market)
read current positions:
  │  getAccountPositionsOnchain (Reader)  = ground-truth count
  │  getOpenPositions (SDK getPositionsInfo, retry until count ≥ ground truth)
  │  → if still short, SKIP cycle (don't act on a partial view)
runReconcile (run-reconcile.ts):
  │  minOrderUsd = MIN_COLLATERAL_USD(onchain) × TARGET_LEVERAGE × MIN_ORDER_SAFETY_MARGIN
  │  planReconcile (reconcile.ts, PURE): per symbol diff target vs current →
  │     open / grow / trim / flatten / flip ; full-close always allowed; cap MAX_TOTAL_NOTIONAL_USD
  │  for each step:
  │     increase → sdk.orders.long/short (payAmount=collateral, leverage)   [ExchangeRouter multicall]
  │     decrease → getDecreasePositionAmounts → sdk.orders.createDecreaseOrder
  │     awaitOrdersCleared (poll sdk.orders.getOrders until keeper executes)
```
Output: GMX positions on E that mirror the signals book (1:1 of NAV). Gated by `DRY_RUN`
(`canBroadcast` = `!DRY_RUN && HOT_PK`); in dry mode it logs the plan, broadcasts nothing.

---

## 4. Backend — nav-cycle (`crons/nav-cycle.ts`)  [GMX → NAV → Lagoon]

```
loadMarkets(sdk)
computeNav (nav/compute.ts):
  │  idle    = USDC.balanceOf(E)                                  [viem readContract]
  │  positions = sdk.positions.getPositionsInfo → Σ netValue      [1e30 → USDC 6dp]
  │  pending = sdk.orders.getOrders → Σ MarketIncrease collateral (counted once)
  │  → navUsdc6 = idle + positionsNet + pendingCollateral         (nav/assemble.ts, PURE)
gas watchdog: publicClient.getBalance(E) → warn + /status.gas if < GAS_MIN_ETH
if canBroadcast && VAULT_ADDRESS:
  │  pushNav (nav/push.ts): read totalSupply/totalAssets → sanityCheckNav
  │     (STRICT_FIRST_NAV_ZERO + NAV_DIVERGENCE_MAX_BPS) → vault.updateNewTotalAssets(navUsdc6)
  │  settleDeposit (settle/execute.ts): vault.settleDeposit(navUsdc6)
  │     ← commits NAV, settles pending deposits AND redeems, re-prices shares
  │     (settleRedeem only as fallback if settleDeposit skipped — avoids re-commit revert)
readVaultState: totalAssets, totalSupply → sharePrice
→ NavCycleResult { nav, positions, vaultState, gas, pushed, settled }
   stored in `status.lastNav`; appended to history (history.record → /history + ndjson)
```
`computeNav` is also called read-only by `navProvider` (trade-cycle scaling) and the snapshot script.

---

## 5. Backend — HTTP out (Fastify, CORS `*`)

| Route | Source | Shape | Consumer |
|---|---|---|---|
| `GET /healthz` | static | `{status, chainId, dryRun}` | Railway healthcheck |
| `GET /status` | `status.lastNav` (last nav-cycle) | `StatusResponse` (`@etesia/shared`): chainId, vault, signer, signalSource, dryRun, updatedAt, **nav**{navUsd,idleUsd,positionsNetUsd,pendingCollateralUsd}, **positions**[], **vaultState**{totalAssetsUsd,totalSupply,sharePrice}, **gas**{ethBalance,low}, pushed, settled, lastTrade* | web cards + positions table + live dot |
| `GET /history[?from=]` | in-memory `HistorySample[]` (one per nav-cycle) | `[{t,navUsd,sharePrice,positionsNetUsd,idleUsd}]` | (built; web chart currently uses Lagoon GraphQL instead) |

---

## 6. Shared contract layer (`packages/shared`)

The only thing both backend and web import — prevents drift.
- **addresses.ts**: `CHAIN_ID` 42161, `VAULT_ADDRESS`, `EXPECTED_EOA` (E), `USDC_ADDRESS`, `WETH_ADDRESS`,
  `ARBISCAN_URL`, `LAGOON_LP_URL`.
- **vault-abi.ts / usdc-abi.ts**: the ABI subsets (backend re-exports these from `abi/`).
- **status.ts**: `StatusResponse`, `StatusNav`, `StatusPosition`, `StatusVaultState`, `StatusGas`,
  `HistorySample` — the backend↔web wire contract.

---

## 7. Web — data sources (`apps/web`)

| UI piece | Source | Cadence | Notes |
|---|---|---|---|
| 4 stat cards (NAV / share price / idle / positions-net) | backend `/status` (`lib/status.ts`, SWR) | 5s | `nav` + `vaultState` |
| Positions table | backend `/status.positions` | 5s | symbol/side/size/netValue |
| "live / offline" dot | backend `/status` ok/error | 5s | — |
| Performance chart | **Lagoon GraphQL** `vaultByAddress.stateHistory` (`lib/lagoon.ts`, SWR) | 60s | share price + NAV series, 1D/7D/ALL |
| `useVaultCore` | vault reads (wagmi `useReadContracts`, `allowFailure:false`): asset, decimals, totalAssets, totalSupply, isTotalAssetsValid, symbol | 30s | feeds deposit/withdraw |
| `useUserPosition` | vault reads: balanceOf, maxMint, pending/claimable deposit+redeem, maxWithdraw | 30s | per-connected-wallet |
| `useAssetAccount` | USDC `balanceOf` + `allowance(owner, vault)` | 30s | approve gating |
| ConnectButton | wagmi `useBalance` (native ETH) | 30s | wallet ETH |
| Withdraw countdown | Lagoon GraphQL `transactions(RedeemRequest)` | 60s | 48h SLA |
| Wallet | injected / EIP-6963 (`lib/wagmi.ts`) | realtime | chain guard vs 42161 |

**Deposit (ERC-7540):** `USDC.approve(vault)` → if `isTotalAssetsValid` then `vault.syncDeposit` else
`vault.requestDeposit` → (settle by backend) → `vault.deposit` (claim shares). **Withdraw:**
`vault.requestRedeem` (or `claimSharesAndRequestRedeem`) → (settle) → `vault.redeem` (claim USDC).
On tx success, all react-query reads are invalidated/refetched.

---

## 8. The money path (deposit → trade → redeem)

```
LP wallet ──requestDeposit(USDC)──► Lagoon Silo (pending)
                                        │  backend nav-cycle: pushNav + settleDeposit
                                        ▼
                       USDC moves Silo ──► E (safe/curator)   + shares mint to LP
                                        │  backend trade-cycle: signals → reconcile
                                        ▼
                       E's USDC = collateral ──► GMX positions (the mirrored book)
   ── redeem reverses: requestRedeem → settleRedeem (via settleDeposit) → USDC Silo→LP ──
```
NAV oracle prices it all: `NAV = idle USDC(E) + Σ position netValue + Σ pending-order collateral`,
pushed to Lagoon so **share price tracks the live GMX portfolio**.

---

## 9. Units / decimals (the conversion boundaries)

| Quantity | Scale | Where converted |
|---|---|---|
| GMX USD (sizeDeltaUsd, prices, pnl) | **1e30** | `gmx/converters.ts` |
| USDC (collateral, NAV asset, `newTotalAssets`) | **6dp** | converters; Lagoon arg |
| Vault shares | **18dp** | share-price math (`totalAssets 6dp / totalSupply 18dp`) |
| acceptablePrice | `indexPrice × 10^(30 − tokenDecimals)` | converters |

---

## 10. Config / env (who reads what)

**Backend** (`apps/backend/.env`, Railway vars): `ARBITRUM_RPC`, `GMX_ORACLE_URL`, `HOT_PK` (secret),
`EXPECTED_EOA`, `VAULT_ADDRESS`, GMX contract addrs, `TARGET_LEVERAGE`, `MIN_ORDER_USD`(0=derive),
`MIN_ORDER_SAFETY_MARGIN`, `MIN_ORDER_FALLBACK_USD`, `MAX_TOTAL_NOTIONAL_USD`, `ACCEPTABLE_PRICE_SLIPPAGE_BPS`,
`SIGNAL_SOURCE` (mock|signals|flat), `SIGNALS_URL`, `MIRROR_DYNAMIC`/`MIRROR_GROSS_LEVERAGE`/`MIRROR_TOP_N`/`MIRROR_SCALE`,
`STRICT_FIRST_NAV_ZERO`, `NAV_DIVERGENCE_MAX_BPS`, `GAS_MIN_ETH`, `DRY_RUN`, `TRADE_CRON`, `NAV_CRON`,
`HISTORY_PATH`, `HISTORY_MAX`, `PORT`(Railway-injected), `LOG_LEVEL`, `NODE_ENV`.

**Web** (`apps/web/.env.local`, Vercel vars, all build-time `NEXT_PUBLIC_`): `NEXT_PUBLIC_BACKEND_URL`,
`NEXT_PUBLIC_ARBITRUM_RPC` (private RPC for onchain reads), `NEXT_PUBLIC_EXPLORER_URL`,
`NEXT_PUBLIC_VAULT_ADDRESS` (override), `NEXT_PUBLIC_LAGOON_API_URL`, `NEXT_PUBLIC_SETTLE_CYCLE_MINUTES`.

---

## 11. Cadence / refresh summary

| Loop | Interval | Effect |
|---|---|---|
| backend trade-cycle | `TRADE_CRON` | re-sync GMX book to signals (orders only on deltas ≥ floor) |
| backend nav-cycle | `NAV_CRON` | compute NAV → push + settle → re-price + history sample + gas check |
| web `/status` (SWR) | 5s | cards, positions, live dot |
| web chart (Lagoon) | 60s | performance history |
| web onchain reads (wagmi) | 30s | vault/user/asset state |

---

## 12. Trust boundaries / safety gates

- **`DRY_RUN`** master switch — no broadcast unless false + `HOT_PK` set.
- **Startup check** — aborts if `HOT_PK`≠E or vault `owner`/`safe`≠E or `asset`≠USDC.
- **NAV guards** — first-NAV-must-be-0; pricePerShare divergence cap per cycle.
- **Reader ground-truth** — never reconcile on a partial SDK position read (no duplicate-open / missed-close).
- **Min-order floor** — tied to GMX on-chain min collateral (avoids sub-min reverts; never thins the book).
- **Gas watchdog** — warns + flags `/status.gas` when E's ETH is low.
- **CORS `*`** — hackathon-only; scope to the web origin for real prod.
