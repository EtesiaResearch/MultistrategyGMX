import Fastify from "fastify";
import cors from "@fastify/cors";
import cron from "node-cron";
import { pino, type LoggerOptions } from "pino";
import { canBroadcast, loadConfig } from "./config.js";
import { makeAccount, makePublicClient, makeWalletClient } from "./clients.js";
import type { Address } from "viem";
import { makeGmxSdk } from "./gmx/sdk.js";
import { makeSignalSource } from "./signal/index.js";
import { runStartupCheck } from "./startup-check.js";
import { tradeCycle } from "./crons/trade-cycle.js";
import { navCycle, type NavCycleResult } from "./crons/nav-cycle.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const loggerOptions: LoggerOptions = { level: cfg.LOG_LEVEL };
  if (cfg.NODE_ENV === "development") loggerOptions.transport = { target: "pino-pretty" };
  const logger = pino(loggerOptions);

  const publicClient = makePublicClient(cfg);
  const walletClient = makeWalletClient(cfg);
  const account = makeAccount(cfg);
  const sdk = makeGmxSdk(cfg);
  const signalSource = makeSignalSource(cfg, logger);

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
      await tradeCycle({ sdk, cfg, logger, signalSource, hasAccount: account !== undefined });
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
      if (result) status.lastNav = result;
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
  app.get("/status", () => ({
    signalSource: signalSource.name,
    signer: account?.address ?? null,
    vault: cfg.VAULT_ADDRESS ?? null,
    dryRun: cfg.DRY_RUN,
    lastTradeAt: status.lastTradeAt,
    lastTradeOk: status.lastTradeOk,
    lastNavAt: status.lastNavAt,
    lastNav: status.lastNav
      ? {
          navUsdc6: status.lastNav.navUsdc6.toString(),
          navUsd: Number(status.lastNav.navUsdc6) / 1e6,
          pushed: status.lastNav.pushed,
          settled: status.lastNav.settled,
        }
      : null,
  }));
  await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
  logger.info({ port: cfg.PORT }, "http server listening (/healthz, /status)");

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
