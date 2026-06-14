# Deploy — Railway (backend) + Vercel (web)

Monorepo: `apps/backend` (the NAV-oracle + executor service) → **Railway**; `apps/web` (Next.js
dashboard) → **Vercel**. `packages/shared` is consumed as TS source by both (no build step).

> Commit everything first (incl. the updated `pnpm-lock.yaml`). `.env` files are gitignored — secrets
> go in the platform dashboards, never in git.

## Backend → Railway

Uses the repo-root `Dockerfile` (+ `railway.json`). The image installs only `@etesia/backend` and its
workspace deps and runs `tsx` (the GMX SDK's ESM build needs tsx, not `node dist`).

1. New Railway project → **Deploy from GitHub repo** → pick this repo. Railway auto-detects the
   `Dockerfile` + `railway.json` (healthcheck `/healthz`).
2. **Variables** (Service → Variables):
   - `HOT_PK` = E's private key (**secret**). Required to broadcast.
   - `DRY_RUN` = `true` until you've validated, then `false`.
   - `ARBITRUM_RPC` = a private RPC (Alchemy/Infura) — the public one rate-limits the cron loop.
   - `NODE_ENV` = `production` (set by the Dockerfile already; logs become raw JSON).
   - *(optional)* `TRADE_CRON`, `NAV_CRON`, `MAX_TOTAL_NOTIONAL_USD`, `TARGET_LEVERAGE`.
   - **Do NOT set `PORT`** — Railway injects it; the service reads `$PORT`.
   - `VAULT_ADDRESS` / `EXPECTED_EOA` are baked into `@etesia/shared`; only override to change them.
   - *(chart history)* The backend records one NAV/share-price sample per NAV cycle (served at
     `/history`, powers the web chart). It's written to `HISTORY_PATH` (default `./data/history.ndjson`).
     Railway's FS is **ephemeral** — to keep the chart across redeploys, add a **Volume** (Service →
     Volumes) mounted at e.g. `/data` and set `HISTORY_PATH=/data/history.ndjson`. Without a volume the
     chart simply rebuilds from the next cycle onward.
3. Deploy. On boot the **startup check** asserts `HOT_PK` controls E and the vault roles resolve to E —
   if not, it aborts (check the logs). Healthcheck hits `/healthz`.
4. Note the public URL (e.g. `https://etesia-backend.up.railway.app`). Verify:
   `curl -i https://<url>/status` → `access-control-allow-origin: *` and the JSON snapshot.
   `curl https://<url>/history` → a JSON array of `{t, navUsd, sharePrice, …}` samples.

If the build fails on `--frozen-lockfile`, ensure `pnpm-lock.yaml` is committed and current
(`pnpm install` locally, commit), or drop `--frozen-lockfile` from the `Dockerfile`.

## Web → Vercel

1. New Vercel project → import this repo.
2. **Root Directory = `apps/web`** (Settings → General). Vercel detects Next.js + the pnpm workspace
   (via the root lockfile + `packageManager`) and installs from the workspace root automatically.
   Framework preset: Next.js (also pinned in `apps/web/vercel.json`).
3. **Environment Variable**: `NEXT_PUBLIC_BACKEND_URL` = the Railway backend URL (no trailing slash).
   It's read at build time, so set it before the first build (and redeploy if it changes).
4. Deploy. The dashboard polls `<backend>/status` every 5s and `<backend>/history` every 15s for the
   performance chart (CORS is open on the backend).

## Order / sanity
- Deploy the backend first, grab its URL, then set `NEXT_PUBLIC_BACKEND_URL` on Vercel.
- Keep `DRY_RUN=true` for the first deploy; confirm `/status` + the dashboard render, then go live
  (see `DEMO.md`: E holds 0 personal USDC → push first NAV=0 → approve USDC → `DRY_RUN=false`).
- CORS is `origin:'*'` (hackathon). For real prod, scope it to the Vercel origin.
