# Etesia GMX

Etesia-style LP vault on **Arbitrum One**: USDC deposits via a **Lagoon ERC-7540 vault**, mirrored
onto **GMX V2 perps** by a hot-EOA executor, with a **GMX-aware NAV oracle** that pushes NAV back to
Lagoon so share price tracks the live portfolio. One Node service (TS + viem + `@gmx-io/sdk` +
node-cron + Fastify).

## Architecture

```
 signal source (mock | signals API: GET /api/positions)
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

## Monorepo layout (pnpm workspace)

```
apps/backend/        the GMX-aware NAV oracle + executor service (TS, tsx, node-cron, Fastify)
  src/
    config.ts        zod env (DRY_RUN master switch, leverage, caps, cadences) — addrs from @etesia/shared
    startup-check.ts fail-fast: HOT_PK controls E, vault owner/safe = E, asset = USDC
    index.ts         boot, CORS, /healthz + /status (StatusResponse), two cron cycles
    gmx/             converters (tested), markets, positions, executor, reconcile (tested), sdk
    signal/          Target/SignalSource; mock + remote signals API (HTTP) + factory
    nav/             assemble (tested), compute, push (sanity guards, tested)
    settle/execute   settleDeposit/settleRedeem (direct EOA, no Zodiac)
    crons/           trade-cycle, nav-cycle (emits the /status snapshot)
  scripts/           probe-markets, snapshot, nav-validation
apps/web/            Next.js 15 read-only dashboard — consumes backend /status, Arbitrum-repointed
  src/app/page.tsx   NAV / share price / idle / positions + Lagoon + Arbiscan links
packages/shared/     single source of truth: chain (42161), VAULT_ADDRESS, EXPECTED_EOA, ABIs,
                     StatusResponse contract (imported by BOTH backend and web)
.claude/gmx.md, .claude/lagoon.md   verified addresses/enums/decimals/APIs
FORNADAR.md          decision log
```

## Run

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env   # backend env (addresses pre-filled)
pnpm typecheck                                   # all 3 packages
pnpm test                                        # 33 backend unit tests
pnpm --filter @etesia/backend exec tsx scripts/probe-markets.ts   # live read-only sanity (no funds)

pnpm dev:backend    # the service on :8080 (DRY_RUN=true by default; /status + /healthz, CORS open)
pnpm dev:web        # the dashboard on :3001 (NEXT_PUBLIC_BACKEND_URL → backend)
```

In `DRY_RUN=true` (default) the service computes NAV and logs the reconcile plan but **never
broadcasts**. Even read-only (no `HOT_PK`) it serves live vault data on `/status` (reads E's address).
The web dashboard polls `/status` every 5s.

## Going live (needs Nadar)

Vault (`0x7f6c…5a2`) and E (`0xee94…b6A`) are already wired (`packages/shared`). Then:

1. Ensure **E holds ZERO personal USDC** (NAV idle = `balanceOf(E)`); only ETH for gas + exec fee.
2. Set `HOT_PK` in `apps/backend/.env` (never commit). Boot aborts unless it controls E and the vault
   roles resolve to E.
3. Push the **first NAV = 0** while the vault is empty (`STRICT_FIRST_NAV_ZERO` enforces it); approve
   USDC to the **SyntheticsRouter** (`0x7452…Cc68…` → see `.claude/gmx.md`) once.
4. Flip `DRY_RUN=false`. Validate with `pnpm --filter @etesia/backend exec tsx scripts/nav-validation.ts`.

See `DEMO.md` for the full go-live sequence (E holds 0 personal USDC → deposit from wallet D → settle).

## Demo

See `DEMO.md`.
