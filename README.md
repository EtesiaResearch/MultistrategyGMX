# Etesia GMX

Etesia-style LP vault on **Arbitrum One**: USDC deposits via a **Lagoon ERC-7540 vault**, mirrored
onto **GMX V2 perps** by a hot-EOA executor, with a **GMX-aware NAV oracle** that pushes NAV back to
Lagoon so share price tracks the live portfolio. One Node service (TS + viem + `@gmx-io/sdk` +
node-cron + Fastify).

## Architecture

```
 signal source (mock | hlnative GET /api/positions)
        │ targets: [{ symbol, signedNotionalUsd }]
        ▼
 ┌──────────────────────────── one node service ────────────────────────────┐
 │  trade-cycle (TRADE_CRON)            nav-cycle (NAV_CRON)                   │
 │   getTargets → reconcile             computeNav (idle + positions          │
 │   → orders.long/short / decrease      + pending-order collateral)          │
 │   → await keeper                     → pushNav → settleDeposit/Redeem      │
 └───────┬───────────────────────────────────────┬──────────────────────────┘
         │ hot EOA signs                          │ hot EOA = valuationManager + curator
         ▼                                        ▼
   GMX V2 (Arbitrum)                       Lagoon vault (Arbitrum)
   keeper fills w/ oracle price            Vault + Silo + (safe = our EOA)
```

The hot EOA is simultaneously the **GMX trader**, the Lagoon **valuationManager**, and the Lagoon
**curator/safe** — so NAV push and settle are plain EOA calls (no Zodiac, no Safe-tx), and settled
deposits land straight in the trading EOA.

## Layout

```
src/
  config.ts            zod env (DRY_RUN master switch, leverage, caps, cadences)
  clients.ts           viem Arbitrum public/wallet clients + hot account
  index.ts             boot, /healthz + /status, two cron cycles, graceful shutdown
  gmx/
    converters.ts      1e30 USD ↔ USDC 6dp ↔ number, acceptablePrice, collateral sizing  (tested)
    markets.ts         SYMBOL → GMX market (USDC-collateralized perps)
    positions.ts       Reader positions → signed notional + netValue
    executor.ts        increase (orders.long/short), decrease (getDecreasePositionAmounts), keeper poll
    reconcile.ts       PURE planner: diff/flip/trim/grow/flatten/min-order/notional-cap  (tested)
    run-reconcile.ts   executes a plan (keeper-aware ordering)
    sdk.ts             GmxSdk init
  signal/              Target/SignalSource; mock + hlnative (HTTP) + factory
  nav/
    assemble.ts        PURE NAV math (idle + Σ netValue + Σ pending collateral)  (tested)
    compute.ts         fetches balances/positions/orders and assembles NAV
    push.ts            sanityCheckNav (first-NAV-0 + divergence, tested) + updateNewTotalAssets
  settle/execute.ts    settleDeposit/settleRedeem (direct EOA, no Zodiac)
  crons/               trade-cycle, nav-cycle
scripts/
  probe-markets.ts     read-only: prove SDK + markets + pricing live (no funds)
  snapshot.ts          demo dashboard: NAV breakdown + positions + vault share price
  nav-validation.ts    empirical NAV harness (open→hold→close, asserts ΔNAV ≈ fees) — needs funds
.claude/gmx.md, .claude/lagoon.md   verified addresses/enums/decimals/APIs
FORNADAR.md            decision log
```

## Run

```bash
pnpm install
cp .env.example .env
pnpm typecheck && pnpm test         # 32 unit tests (converters, reconcile, NAV math, sanity guards)
pnpm tsx scripts/probe-markets.ts   # live read-only sanity (no funds/signer needed)
pnpm dev                            # boots the service; DRY_RUN=true by default
```

In `DRY_RUN=true` (default) the service computes NAV and logs the reconcile plan but **never
broadcasts**. `/status` shows last NAV + last trade cycle.

## Going live (needs Nadar)

1. Deploy the Lagoon vault on Arbitrum (asset = USDC, async, name "Etesia GMX"); set **both
   valuationManager AND curator/safe to the hot EOA**. Put `VAULT_ADDRESS` (+ `SILO_ADDRESS`) in `.env`.
2. Fund the hot EOA with **ETH** (gas + GMX execution fees) and **USDC** on Arbitrum.
3. Set `HOT_PK` (never commit it) and approve USDC to the **SyntheticsRouter**
   (`0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6`) once.
4. Push the **first NAV = 0** while the vault is empty: the `STRICT_FIRST_NAV_ZERO` guard enforces this.
5. Flip `DRY_RUN=false`. Validate with `pnpm tsx scripts/nav-validation.ts`.

## Demo

See `DEMO.md`.
