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

---

## 2026-06-14 — Live addresses wired + fail-fast startup check + NAV cleanliness + CORS

**Live vault** `0x7f6c5ed71ca969168247958057fcfe06c68ad5a2` (Arbitrum One). **E** (single hot EOA =
trader = valuationManager = curator/safe) = `0xee94E1A5534A70231DaEE670b51fEC50AC032b6A`. Defaulted
both into `config.ts` (`VAULT_ADDRESS`, `EXPECTED_EOA`) and `.env`/`.env.example`.

**Probed the deployed vault live:** `owner()` = `safe()` = E ✓, `asset()` = native USDC ✓.
`decimals()` = **18** = the *share* token (asset USDC stays 6dp — NAV push uses 6dp, correct). This
deploy is an **older ABI**: `getRolesStorage()`, `pendingSilo()`, `valuationManager()` all revert
(selectors absent), but `owner()`/`safe()` standalone getters work.

**Fail-fast startup check** (`src/startup-check.ts`, wired into `index.ts` before cycles):
- HOT_PK set → assert `getAddress(account) === EXPECTED_EOA`, else abort.
- `vault.owner()` and `vault.safe()` must equal E (hard abort) — settle is `onlySafe`.
- `vault.asset()` must equal native USDC (hard abort).
- `valuationManager`: best-effort via `getRolesStorage()`→`valuationManager()`; this deploy exposes
  neither, so we WARN and rely on the **push-time simulation** guard (updateNewTotalAssets reverts if
  E isn't the valuationManager). Verified live: prints the warning, owner+safe+asset all ✓.
- Silo getter n/a on this deploy → logged; NAV never reads it anyway.

**NAV cleanliness (corrected guidance):** NAV idle = `balanceOf(E)` ONLY (compute.ts) — never Silo or
vault balance, so Lagoon pending deposits (held in the Silo until settle) can't be double-counted.
Added a unit test pinning that contract (`assemble.test.ts`, now 33 tests). **E must hold ZERO personal
USDC**; boot warns loudly if `balanceOf(E) > 0 && totalSupply == 0`. The earlier "keep ~40–50 USDC on
E" note was for a separate-Safe design and is WRONG here — GMX collateral comes from deposited USDC
that settle moves into E. Go-live sequence documented in DEMO.md.

**CORS (deliberate hackathon-only):** registered `@fastify/cors` with `origin: '*'` globally before
routes (no credentials — front is read-only fetch). Covers `/status`, `/healthz`, OPTIONS preflight.
No `WEB_ORIGIN` env / allowlist. Verified: `GET /status` → `access-control-allow-origin: *`, preflight
204. **Revert to a scoped origin for any real deployment.**

**33/33 tests green; typecheck clean.**

---

## 2026-06-14 — Monorepo restructure + UIVaultHL front port

**pnpm workspace** (`apps/*`, `packages/*`):
- `apps/backend/` — the service (moved `src/scripts/tests/.env*/tsconfig` here; `@etesia/backend`).
- `apps/web/` — Next.js 15 read-only dashboard (`@etesia/web`).
- `packages/shared/` — `@etesia/shared`: chain (42161), VAULT_ADDRESS, EXPECTED_EOA, USDC/WETH, vault +
  usdc ABIs, and the **`StatusResponse`** contract. Backend re-exports the ABIs from here and pulls
  config defaults from here; web imports addresses + StatusResponse. Single source of truth.
- Run via `tsx` (no build); `@etesia/shared` is consumed as TS source (`exports: ./src/index.ts`,
  `transpilePackages` in next.config). **shared internal re-exports are extensionless** — `.js` broke
  Next's webpack resolver; extensionless works under tsc Bundler + tsx + webpack alike.

**`/status` now emits the shared `StatusResponse`** (chainId, vault, nav breakdown, positions,
vaultState{totalAssets, totalSupply, sharePrice}, pushed/settled). nav-cycle builds the snapshot and
reads vault state for share price. **Read-only NAV**: `sdk.setAccount(EXPECTED_EOA)` + nav-cycle uses
E's address even with no signer, so the dashboard shows live vault data without a key.

**Front port (read-only, pragmatic):** UIVaultHL's `apps/web` is a big monorepo app coupled to an HL
indexer (`/api/portfolio/current`, fills, pnl, metrics) + Lagoon GraphQL. Per Nadar's note (read-only
demo; deposit/redeem can stay on the Lagoon page), I kept the **Etesia theme** (tailwind palette,
fonts, globals.css) and built a focused dashboard wired to my `/status`, dropping the wagmi/indexer/
Lagoon-GraphQL apparatus. Repointed chain → Arbitrum, vault → `@etesia/shared`. `next build` ✓ (static),
serves the dashboard (NAV / share price / idle / positions + Lagoon + Arbiscan links), polling /status
every 5s. The richer components (charts/fills/flows/deposit) can be layered back by pointing their
hooks at the backend later.

**CORS:** `@fastify/cors` `origin:'*'` (hackathon-only) so the web reads `/status` from any origin.

**All 3 packages typecheck; 33/33 backend tests green; backend + web verified running together.**

---

## 2026-06-14 — Deploy config: Railway (backend) + Vercel (web)

- Root `Dockerfile` + `railway.json` for the **backend** on Railway: `node:22-slim`, corepack pnpm
  10.30.1 (pinned via root `packageManager`), `pnpm install --filter "@etesia/backend..."
  --frozen-lockfile` (skips the web Next toolchain; keeps devDeps for tsx), `CMD pnpm --filter
  @etesia/backend start`. Healthcheck `/healthz`. Reads Railway's `$PORT`. Lockfile verified in sync
  (frozen install no-op). **Could not build the image locally — Docker daemon was down; Railway builds it.**
- **Web** on Vercel: Root Directory = `apps/web`, `vercel.json` framework=nextjs, env
  `NEXT_PUBLIC_BACKEND_URL` = Railway URL (build-time). Vercel installs the pnpm workspace from root.
- Secrets: `HOT_PK` is in `apps/backend/.env` (gitignored) locally and set as a **Railway variable** in
  prod — never committed. `DRY_RUN` stays true until validated. Steps in `DEPLOY.md`.

---

## 2026-06-14 — GO-LIVE A1–A4 executed onchain (Arbitrum mainnet)

Docker image built OK locally (`etesia-backend:test`). HOT_PK provided in `apps/backend/.env`.
Preflight (`scripts/preflight.ts`) confirmed: key controls E, E holds **0 USDC** + 0.0059 ETH, vault
owner=safe=E, asset=USDC, **totalSupply=0** (fresh).

- **A1 ✓** E holds 0 personal USDC — already satisfied, nothing moved.
- **A2 ✓** HOT_PK controls E (`0xee94…b6A`).
- **A3 ✓** approved USDC → SyntheticsRouter (`0x7452…Cc68`), unlimited (PoC; scope for real prod).
  tx `0x77f98526008f52d1bcf84a2b5c07689f6f0bc958448f449e0a62e8b8f912060b` (success).
- **A4 ✓** pushed first NAV = 0 (`updateNewTotalAssets(0)`) on the empty vault; guard allowed it.
  tx `0x1e682f04c3f8ff183bf639919ab2bba836ee84686874a94fa1b1e0b454e37418` (success, gas 128378).
- **A5 ⛔ BLOCKED** `nav-validation` opens a real GMX position needing USDC collateral on E, but E
  holds 0 USDC. Requires an LP deposit from wallet D → settle (USDC Silo→E) first — a human/external
  step. `DRY_RUN` left **true** (flipping it now would make the trade loop try to open with 0 USDC).
  New scripts: `preflight.ts`, `approve-usdc.ts`, `push-first-nav-zero.ts`.

**Deposit → settle → shares PROVEN ONCHAIN (50 USDC):** LP (wallet D) `requestDeposit(50 USDC)` on the
Lagoon page → 50 USDC pending in Silo. Ran `scripts/settle-once.ts` (user-confirmed): computeNav=0 →
`updateNewTotalAssets(0)` tx `0x7f72674a…` → `settleDeposit(0)` tx `0x43a550a5…`. Result: **50 shares
minted to D, vault totalAssets=50, share price=1.0, 50 USDC moved Silo→E**. `settleRedeem` skipped
(nothing pending). E now holds 50 USDC of vault funds → **A5 unblocked**. New script `settle-once.ts`.
Note: settle is a guarded financial op — the auto-mode classifier required an explicit "settle" from
Nadar before executing (good).

**A5 — empirical NAV validation PASSED onchain.** `scripts/nav-validation.ts` (DRY_RUN=false inline)
opened ETH ~$15 long ($7.50 collateral @2x) then full-closed, via the keeper. Final onchain state:
position flat, E idle = **49.98 USDC** = 50 − ~$0.017 roundtrip fees. Mid-flight NAV held at 50 (the
pending-collateral term captured collateral in the OrderVault — the #1 async bug, neutralised). The
in-script ΔNAV snapshots fired slightly ahead of keeper execution (async), but the settled state
confirms the formula. **GMX-aware NAV is trustworthy. The full loop — deposit→settle→shares, open→
close on GMX, NAV tracks — is proven on Arbitrum mainnet.** Switched to a private Alchemy RPC.
Fixed a cosmetic share-price display bug in `snapshot.ts` (6dp/18dp). Swapped to a private Alchemy
`ARBITRUM_RPC` (secret — in `.env` + Railway var, never committed).

---

## 2026-06-14 — Railway LIVE, ops fixes (cadence + gas watchdog + flat), read-flakiness flagged

Backend deployed on Railway with **DRY_RUN=false** → it traded for real: pushed NAV (tx 0x836ace70…)
and opened the mock ETH $15 long. State held safe overnight: ETH 0.005, NAV ~$49.88, pps ~0.9974
(GMX-aware NAV correctly flowing into the share price). Burn was tiny (~0.0009 ETH) because Lagoon
reverts a re-proposed unsettled NAV → most `updateNewTotalAssets` revert at `simulate` (free).

**My mistake (Nadar rightly annoyed):** shipped `NAV_CRON=TRADE_CRON=*/2min` default + no gas watchdog,
ignoring etesia-curator's lessons (12h settle, gas watchdog). See [[apply-curator-ops-lessons]]. Fixes:
- Cadence default → **15 min** (`*/15`). Prod should be slower (~12h).
- **`SIGNAL_SOURCE=flat`** (new `FlatSignalSource`) → returns no targets → bot closes everything and
  stays flat (wind-down without stopping the service).
- **Gas watchdog**: nav-cycle reads E's ETH each cycle, WARNs below `GAS_MIN_ETH` (0.002), surfaced in
  `/status.gas`.
- Did NOT do push-on-change (skipping push on flat NAV) — unsafe without pending-deposit detection (a
  pending deposit doesn't move computed NAV, so gating the push would stop deposits settling). Needs
  curator's `detectPending` ported first.

**ROOT CAUSE corrected (was misdiagnosed as "empty reads"):** `flat` / any flatten refused to close
the **$14.98** ETH position because `reconcile` gated EVERY delta on `MIN_ORDER_USD=15` — including
full closes. A probe (`scripts/probe-positions.ts`) showed position reads are reliable (5/5), so the
`steps: 0` was the min-order gate, not an empty read. **Fix:** `planReconcile` now ALWAYS allows a full
close / flatten (and a flip's close), gating only opens/grows/trims. Verified: `flat` plans
`decrease ETH fullClose 14.98`. Tests added (38 total).

**Robustness (2nd-opinion review was right re: the SDK):** the GmxSdk builds its viem clients with
transport **retries disabled**, and GMX docs say wrap your own retry/backoff — a flaky RPC or partial
`tokensData` (positions referencing unpriced tokens get dropped) yields a silent empty list. Added
`util/retry.ts` (`withRetry` w/ exp backoff): `loadMarkets` retries until markets+tokens are COMPLETE
(the real cure for partial-data empties), `getOpenPositions` retries on error. Kept the trade-cycle
re-read as a net.

**DONE — on-chain Reader ground-truth (#3) + top-N mirror (#4):**
- `gmx/reader-positions.ts`: `getAccountPositionsOnchain` reads `SyntheticsReader.getAccountPositions`
  (DataStore + account → raw Position.Props, NO prices) — never drops a position. Verified live (1 pos,
  ETH long $14.98). The trade-cycle now cross-checks the SDK's count against this ground truth and
  re-reads (fresh markets, backoff) until they match; if still short, it **skips reconcile this cycle**
  rather than act on a partial view (prevents duplicate-open / missed-close on the close-critical path).
- `MIRROR_TOP_N` + `topNTargets` (tested): mirror only the N largest hlnative legs so a big book fits a
  small vault (else every leg falls below MIN_ORDER_USD). 0 = all.
- 40 tests green. Note: REST `fetchApiPositionsInfo` deliberately NOT used for reconcile (indexing lag).

---

## 2026-06-14 — Faithful full-book mirror at $100 NAV (min-order floor + PAXG→GOLD + scaling fix)

Goal: replicate the FULL hlnative book, stop dropping legs, keep ops safety. Three fixes:
1. **Min-order floor derived from GMX's real minimum** (not arbitrary $15). `MIN_ORDER_USD` default → 0 =
   derive `MIN_COLLATERAL_USD (on-chain, DataStore) × TARGET_LEVERAGE × MIN_ORDER_SAFETY_MARGIN(1.5)`,
   fallback `MIN_ORDER_FALLBACK_USD($5)`. Live: MIN_COLLATERAL_USD=$1 → floor=$3 (was $15). Per-leg
   revert guard in `increasePosition` (skip + log only if a leg's collateral < on-chain min — never
   fires at healthy NAV). Top-N stays OFF (`MIRROR_TOP_N=0`) — not a book-thinner.
2. **Scaling-denominator fix:** the dynamic mirror was scaling the book to NAV using the FULL gross
   incl. untradable legs → PAXG ($287, ~29%) shrank every other leg below the floor. Now the trade-cycle
   passes the GMX-supported symbol set into `getTargets(ctx)`; the adapter filters to tradable BEFORE
   scaling, so the denominator only includes legs we'll place.
3. **PAXG→GOLD mapping (was wrongly dropped):** GMX HAS gold/silver synthetic perps on Arbitrum — index
   symbols `GOLD` ($4234 = XAU/USD), `SILVER` ($68 = XAG/USD), plus `XAUT`. Added `HL_TO_GMX_SYMBOL =
   { PAXG: "GOLD" }` in the adapter (PAXG ≈ XAU, $4224≈$4234). Re-verified XMR ($341) IS on GMX — kept.
   Net: the full 11-leg book maps, **`notOnGmx: []`, nothing dropped**.

Verified DRY at NAV $99.91: **11 steps, all legs placed** — BTC $11.2, ETH flip (close $15→short $8.4),
SOL $7.1, AVAX $6.6, BNB $5.9, DOGE $5.6, SUI $5.0, LINK $8.1, XRP $10.1, **GOLD $31.7** (PAXG's ~29%
weight preserved). Σ|notional| ≈ NAV (gross lev 1). Adapter logs the mapped-vs-dropped split. 41 tests
green; ops safety (gas watchdog, 15min cadence, NAV divergence, first-NAV-0, Reader ground-truth) intact.
