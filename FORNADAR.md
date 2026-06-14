# FORNADAR — Etesia GMX decision log

Append-only. Log every non-obvious choice: addresses verified, enum ordinals, decimals, leverage
defaults, deviations from the brief, empirical NAV ratios.

---

## 2026-06-14 — Phase 0: recon, decisions, scaffold

**Recon corrected the brief's assumptions:**
- `etesiaGMX` repo was empty. The reusable code lives in sibling repos:
  - `etesia-curator` = the Lagoon *valuation + settle* service (NAV push, sanity guards, monitoring,
    cron). NOT a trading bot. → template for our NAV/settle layer.
  - `hlnative` = the Hyperliquid *executor + signal API* (`GET /api/positions`). → our signal source
    + reconciliation model.
- This GMX service = (hlnative executor, on GMX) + (etesia-curator NAV/settle, on Arbitrum).

**Decisions (confirmed with Nadar):**
1. **Settle auth = EOA as curator (full auto).** Single hot EOA = valuationManager + curator/safe +
   GMX trader. Drops Zodiac entirely; drops the Safe→EOA transfer (deposits settle straight into the
   trading EOA). NAV idle term collapses to one address.
2. **Signal source = mock-first, then HTTP** consuming `hlnative GET /api/positions`.
3. **Build against mocks + public GMX SDK now**; live txs gate on vault deploy + EOA funding. Master
   switch `DRY_RUN` (default true).
4. **Adopt `@gmx-io/sdk`** (1.6.3, active) over raw viem+ABIs.
5. **Dropped vs. brief:** the curator's `bridge/` module (HyperEVM↔HyperCore) — Arbitrum is single-chain.

**Verified facts** → `.claude/gmx.md`, `.claude/lagoon.md`. Notable:
- Approvals go to the **SyntheticsRouter** `0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6`, not ExchangeRouter.
- OrderType: MarketIncrease=**2**, MarketDecrease=**4**.
- USD scale = **1e30**; USDC = 6dp; `acceptablePrice = indexPrice × 10^(30 − indexTokenDecimals)`.
- Lagoon `newTotalAssets` units = USDC 6dp; push + settle must be same cycle; first NAV = 0.

**Trading defaults (initial, tune later):** TARGET_LEVERAGE=2, MIN_ORDER_USD=15,
MAX_TOTAL_NOTIONAL_USD=200, ACCEPTABLE_PRICE_SLIPPAGE_BPS=150.

**Stack:** pnpm (minimumReleaseAge=1440, excluding @gmx-io/sdk), TS ESM (ES2022, strict), viem
(arbitrum), node-cron, fastify, pino, zod. DB deferred (JSON/in-memory state for the hackathon).

**Address verification (doc-check-first PASSED):** all 6 GMX addresses baked into `config.ts` match
`@gmx-io/sdk@1.6.3` → `build/esm/src/configs/contracts.js` for chainId 42161 exactly (ExchangeRouter,
SyntheticsRouter, OrderVault, DataStore, SyntheticsReader, ReferralStorage). Installed: viem 2.52.2,
@lagoon-protocol/v0-core 0.19.16, v0-viem 0.18.10.

**Phase 0 DONE:** `pnpm dev` hello-loop boots, `/healthz` returns live Arbitrum block, heartbeat
reaches RPC, graceful shutdown works. `DRY_RUN=true` default; no signer needed for read-only boot.

---

## 2026-06-14 — Phase 1: GMX SDK API mapping + executor

**`@gmx-io/sdk@1.6.3` API (verified by reading installed source):**
- Init: `new GmxSdk({ chainId, rpcUrl, oracleUrl, subsquidUrl, publicClient, walletClient, account })`.
  `subsquidUrl` is type-required but only used by `getTradeHistory` (we don't call it) → pass the
  GMX arbitrum squid URL as a filler.
- Submodules: `sdk.markets.getMarketsInfo()` → `{marketsInfoData, tokensData}`; `sdk.positions
  .getPositionsInfo({marketsInfoData, tokensData, showPnlInLeverage})` + `.getPositionsConstants()`
  → `{minCollateralUsd, minPositionSizeUsd, maxAutoCancelOrders}`; `sdk.orders.long/short(params)`,
  `.createDecreaseOrder(...)`, `.getOrders(...)`; `sdk.oracle.getTickers()`; `sdk.utils.getExecutionFee/
  getUiFeeFactor/getGasLimits/getGasPrice`.
- **Open/increase:** `sdk.orders.long/short({ payAmount (USDC 6dp), marketAddress, payTokenAddress,
  collateralTokenAddress, allowedSlippageBps, leverage (bps bigint, 1x=10000n), marketsInfoData,
  tokensData })` — auto-computes acceptablePrice + executionFee and **broadcasts the tx**.
- **Close/decrease:** compute `decreaseAmounts = getDecreasePositionAmounts({ marketInfo,
  collateralToken, isLong, position, closeSizeUsd, keepLeverage:false, minCollateralUsd,
  minPositionSizeUsd, uiFeeFactor, ... })` (from `@gmx-io/sdk/utils/trade`), then
  `sdk.orders.createDecreaseOrder({...})` — it computes executionFee internally.
- Approvals: USDC must be approved to **SyntheticsRouter** before the first increase (SDK assumes it).
- All order methods broadcast immediately (no prepared-request to inspect) → we gate on `canBroadcast`
  and only call them when `DRY_RUN=false` + `HOT_PK` set; otherwise log the planned action.

**ESM quirk:** the SDK's `build/esm` uses extensionless relative imports → works under `tsx`/esbuild,
FAILS under raw `node dist`. **Decision: run via `tsx` (dev + `start`)**, keep `tsc --noEmit` for
typecheck only. Removed the `node dist` start script.

**Converters DONE:** `src/gmx/converters.ts` (1e30↔USDC6↔number, acceptablePrice slippage, collateral
sizing, parseUsdc6) — 14/14 vitest green.

**Dual-viem gotcha:** pnpm installs viem 2.52.2 twice (peer-hashed by typescript 5.9.3 vs the SDK's
5.4.2); a `pnpm.overrides typescript` did NOT collapse it. The only nominal clash is the `walletClient`
we hand to `GmxSdk` → cast `as unknown as NonNullable<GmxSdkConfig["walletClient"]>` at that one
boundary (`src/gmx/sdk.ts`). Runtime is identical.

**vitest can't import the SDK runtime** (extensionless ESM). Kept the pure planner (`reconcile.ts`:
`planReconcile`, `positionsBySymbol`) free of SDK runtime imports; effectful `runReconcile` lives in
`run-reconcile.ts`. Tests cover only pure logic; SDK-touching scripts run under tsx.

**Phase 1 modules built + typecheck clean; 22/22 tests green:** converters, markets (symbol→market),
positions (signed notional + netValue for NAV), executor (`increasePosition` via `orders.long/short`,
`decreasePosition` via `getDecreasePositionAmounts`+`createDecreaseOrder`, `awaitOrdersCleared`),
reconcile planner (diff/flip/trim/grow/flatten/min-order/cap-scaling), mock signal source.

**Live read path VERIFIED (no funds), `scripts/probe-markets.ts`:** 113 GMX markets loaded; market
addresses match cheat-sheet exactly — BTC `0x47c0…` ($64,441), ETH `0x70d9…` WETH/USDC ($1,679.67),
SOL `0x0940…` ($68.94). SDK init + oracle + multicall + converters all good against Arbitrum mainnet.

**Phase 1 REMAINING (gated on funding):** actually broadcast open/close of a tiny ETH position from a
funded EOA + read it back via Reader. All code is DRY_RUN-gated and ready; flip `DRY_RUN=false` + set
`HOT_PK`. Pre-req: approve USDC to SyntheticsRouter once before the first increase.

---

## 2026-06-14 — Phases 2–5: NAV oracle, Lagoon wiring, signal mirror, service loop

**NAV (Phase 2):** `nav/assemble.ts` (PURE, tested — incl. pending-collateral-counted-once) +
`nav/compute.ts` (idle USDC `balanceOf` + Σ position `netValue` + Σ pending-increase collateral).
**Markets are refetched every cycle** so position valuation uses live oracle prices (a cached bundle
would freeze NAV). Empirical harness `scripts/nav-validation.ts` written (gated on funds).

**Lagoon (Phase 3):** ported `sanityCheckNav` (first-NAV-0 + divergence, tested) into `nav/push.ts`;
reads totalSupply/totalAssets via own viem + minimal vault ABI (no @lagoon lib → no extra viem clash).
`settle/execute.ts` = direct EOA `settleDeposit/settleRedeem`, simulate-first and skip on revert
(= nothing pending). Push + settle run in the same nav-cycle (push alone doesn't move pricePerShare).

**Signal mirror (Phase 4):** `signal/hlnative.ts` reads `GET /api/positions`, maps `BASE_USDC_USDC`→
`BASE`, drops `XYZ_*` (RWA), `signedNotional = sign(baseUnits)·|notionalUsd|·MIRROR_SCALE`. Factory
picks mock|hlnative from `SIGNAL_SOURCE`. trade-cycle drops symbols with no GMX market.

**Service loop (Phase 5):** `index.ts` wires SDK + signal + two node-cron cycles (in-flight locks),
Fastify `/healthz` + `/status`, graceful shutdown.

**Integration verified live (DRY_RUN, throwaway key, no funds):** boot → load 113 markets → nav-cycle
computes NAV=$0 from live balanceOf+positions+orders → trade-cycle plans ETH $15 long, $7.50 collateral
@2x on market 0x70d9… → `/status` + `scripts/snapshot.ts` render correctly. **32/32 unit tests green;
typecheck clean.**

**Remaining = task #7 only:** funded-EOA + deployed-vault live broadcasts (open/close, push NAV,
settle, deposit/redeem round-trip). Code is complete + DRY_RUN-gated; go-live = fill env + flip flag.
Docs: README.md (go-live checklist) + DEMO.md (judge script).
