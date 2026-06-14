import type { GmxSdk } from "@gmx-io/sdk";
import type { Logger } from "pino";
import type { Address, PublicClient, WalletClient } from "viem";
import { canBroadcast, type Config } from "../config.js";
import { loadMarkets } from "../gmx/markets.js";
import { computeNav } from "../nav/compute.js";
import { pushNav } from "../nav/push.js";
import { settleDeposit, settleRedeem } from "../settle/execute.js";

export interface NavCycleDeps {
  sdk: GmxSdk;
  cfg: Config;
  logger: Logger;
  publicClient: PublicClient;
  walletClient?: WalletClient | undefined;
  account?: Address | undefined;
}

export interface NavCycleResult {
  navUsdc6: bigint;
  pushed: boolean;
  settled: { deposit: boolean; redeem: boolean };
}

// One NAV cycle: compute GMX-aware NAV -> (live) push it to Lagoon -> settle deposit
// & redeem in the SAME cycle (push alone doesn't move pricePerShare; settle does).
export async function navCycle(deps: NavCycleDeps): Promise<NavCycleResult | null> {
  const { sdk, cfg, logger, publicClient, walletClient, account } = deps;

  if (!account) {
    logger.warn("nav-cycle: no account (set HOT_PK) — skipping");
    return null;
  }

  const bundle = await loadMarkets(sdk);
  const nav = await computeNav({
    sdk,
    publicClient,
    bundle,
    account,
    usdc: cfg.USDC_ADDRESS as Address,
    logger,
  });

  if (!canBroadcast(cfg) || !cfg.VAULT_ADDRESS || !walletClient) {
    logger.info(
      { navUsdc6: nav.navUsdc6.toString(), dryRun: cfg.DRY_RUN, vault: cfg.VAULT_ADDRESS ?? null },
      "nav-cycle: computed NAV (not pushing — dry-run / no vault / no signer)",
    );
    return { navUsdc6: nav.navUsdc6, pushed: false, settled: { deposit: false, redeem: false } };
  }

  const vault = cfg.VAULT_ADDRESS as Address;
  const pushResult = await pushNav(
    {
      publicClient,
      walletClient,
      vault,
      logger,
      strictFirstNavZero: cfg.STRICT_FIRST_NAV_ZERO,
      navDivergenceMaxBps: cfg.NAV_DIVERGENCE_MAX_BPS,
    },
    nav.navUsdc6,
  );
  logger.info({ txHash: pushResult.txHash, navUsdc6: nav.navUsdc6.toString() }, "pushed NAV");

  // Settle both — each skips itself if there's nothing pending (simulation reverts).
  const settleDeps = { publicClient, walletClient, vault, logger };
  const dep = await settleDeposit(settleDeps, nav.navUsdc6);
  const red = await settleRedeem(settleDeps, nav.navUsdc6);

  return {
    navUsdc6: nav.navUsdc6,
    pushed: true,
    settled: { deposit: !dep.skipped, redeem: !red.skipped },
  };
}
