import Fastify from "fastify";
import cors from "@fastify/cors";
import cron from "node-cron";
import { pino, type LoggerOptions } from "pino";
import { canBroadcast, loadConfig } from "./config.js";
import { makeAccount, makePublicClient, makeWalletClient } from "./clients.js";
import type { Address } from "viem";
import type { StatusResponse } from "@etesia/shared";
import { makeGmxSdk } from "./gmx/sdk.js";
import { makeSignalSource } from "./signal/index.js";
import { runStartupCheck } from "./startup-check.js";
import { loadMarkets } from "./gmx/markets.js";
import { computeNav } from "./nav/compute.js";
import { usdc6ToNumber } from "./gmx/converters.js";
import { tradeCycle } from "./crons/trade-cycle.js";
import { navCycle, type NavCycleResult } from "./crons/nav-cycle.js";
import { makeHistoryStore } from "./history.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const loggerOptions: LoggerOptions = { level: cfg.LOG_LEVEL };
  if (cfg.NODE_ENV === "development") loggerOptions.transport = { target: "pino-pretty" };
  const logger = pino(loggerOptions);

  const publicClient = makePublicClient(cfg);
  const walletClient = makeWalletClient(cfg);
  const account = makeAccount(cfg);
  const sdk = makeGmxSdk(cfg);
  // NAV provider for the dynamic signals mirror — reads E's live NAV (idle + positions).
  const readAccount = (account?.address ?? cfg.EXPECTED_EOA) as Address;
  const navProvider = async (): Promise<number> => {
    const bundle = await loadMarkets(sdk);
    const nav = await computeNav({ sdk, publicClient, bundle, account: readAccount, usdc: cfg.USDC_ADDRESS as Address });
    return usdc6ToNumber(nav.navUsdc6);
  };
  const signalSource = makeSignalSource(cfg, logger, navProvider);

  logger.info(
    {
      chainId: cfg.CHAIN_ID,
      signer: account?.address ?? "(none — read-only)",
      vault: cfg.VAULT_ADDRESS ?? "(not deployed)",
      dryRun: cfg.DRY_RUN,
      canBroadcast: canBroadcast(cfg),
      signalSource: signalSource.name,
      targetLeverage: cfg.TARGET_LEVERAGE,
      maxNotionalUsd: cfg.MAX_TOTAL_NOTIONAL_USD,
    },
    "etesia-gmx booting",
  );

  // Fail-fast: HOT_PK controls E, vault roles resolve to E, asset == USDC. A hard
  // failure here aborts boot (push/settle would only revert downstream).
  await runStartupCheck({
    publicClient,
    logger,
    account: account?.address,
    expectedEoa: cfg.EXPECTED_EOA as Address,
    vault: cfg.VAULT_ADDRESS as Address | undefined,
    usdc: cfg.USDC_ADDRESS as Address,
  });

  // NAV/share-price history for the web chart (loaded from disk, capped in memory).
  const history = await makeHistoryStore({ path: cfg.HISTORY_PATH, max: cfg.HISTORY_MAX, logger });

  // Shared mutable status for the /status endpoint + watchdogs.
  const status = {
    lastTradeAt: 0,
    lastTradeOk: false,
    lastNavAt: 0,
    lastNav: null as NavCycleResult | null,
    tradeInFlight: false,
    navInFlight: false,
  };

  async function runTrade(): Promise<void> {
    if (status.tradeInFlight) return logger.warn("trade-cycle still in flight; skip");
    status.tradeInFlight = true;
    try {
      await tradeCycle({ sdk, cfg, logger, publicClient, signalSource, hasAccount: account !== undefined });
      status.lastTradeOk = true;
    } catch (err) {
      status.lastTradeOk = false;
      logger.error({ err }, "trade-cycle failed");
    } finally {
      status.lastTradeAt = Date.now();
      status.tradeInFlight = false;
    }
  }

  async function runNav(): Promise<void> {
    if (status.navInFlight) return logger.warn("nav-cycle still in flight; skip");
    status.navInFlight = true;
    try {
      const result = await navCycle({ sdk, cfg, logger, publicClient, walletClient, account: account?.address });
      if (result) {
        status.lastNav = result;
        history.record({
          t: Date.now(),
          navUsd: result.nav.navUsd,
          sharePrice: result.vaultState?.sharePrice ?? null,
          positionsNetUsd: result.nav.positionsNetUsd,
          idleUsd: result.nav.idleUsd,
        });
      }
    } catch (err) {
      logger.error({ err }, "nav-cycle failed");
    } finally {
      status.lastNavAt = Date.now();
      status.navInFlight = false;
    }
  }

  const app = Fastify({ logger: false });
  // Wide-open CORS — deliberate hackathon-only choice so any local/Railway web front
  // can read /status + /healthz. No credentials (front is read-only fetch), so '*' is
  // correct. Registered before routes; @fastify/cors handles OPTIONS preflight globally.
  // For a real deployment, scope `origin` to the web origin.
  await app.register(cors, { origin: "*" });
  app.get("/healthz", () => ({ status: "ok", chainId: cfg.CHAIN_ID, dryRun: cfg.DRY_RUN }));
  app.get("/status", (): StatusResponse => {
    const n = status.lastNav;
    return {
      chainId: cfg.CHAIN_ID,
      vault: cfg.VAULT_ADDRESS ?? null,
      signer: account?.address ?? null,
      signalSource: signalSource.name,
      dryRun: cfg.DRY_RUN,
      updatedAt: status.lastNavAt,
      nav: n?.nav ?? null,
      positions: n?.positions ?? [],
      vaultState: n?.vaultState ?? null,
      gas: n?.gas ?? null,
      pushed: n?.pushed ?? false,
      settled: n?.settled ?? { deposit: false, redeem: false },
      lastTradeAt: status.lastTradeAt,
      lastTradeOk: status.lastTradeOk,
    };
  });
  // Time series for the web chart. `?from=<ms>` filters to samples at/after that instant.
  app.get("/history", (req) => {
    const from = Number((req.query as { from?: string }).from);
    return history.list(Number.isFinite(from) && from > 0 ? from : undefined);
  });
  await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
  logger.info({ port: cfg.PORT }, "http server listening (/healthz, /status, /history)");

  // Run one of each immediately so the first sample is fresh.
  await runNav();
  await runTrade();

  const tradeTask = cron.schedule(cfg.TRADE_CRON, () => void runTrade());
  const navTask = cron.schedule(cfg.NAV_CRON, () => void runNav());

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    tradeTask.stop();
    navTask.stop();
    void app.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("fatal boot error:", err);
  process.exit(1);
});
