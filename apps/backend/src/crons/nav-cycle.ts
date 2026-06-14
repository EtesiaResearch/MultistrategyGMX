import type { GmxSdk } from "@gmx-io/sdk";
import type { StatusNav, StatusPosition, StatusVaultState } from "@etesia/shared";
import type { Logger } from "pino";
import type { Address, PublicClient, WalletClient } from "viem";
import { vaultAbi } from "../abi/vault.js";
import { canBroadcast, type Config } from "../config.js";
import { usdc6ToNumber } from "../gmx/converters.js";
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
  nav: StatusNav;
  positions: StatusPosition[];
  vaultState: StatusVaultState | null;
}

// One NAV cycle: compute GMX-aware NAV -> (live) push it to Lagoon -> settle deposit
// & redeem in the SAME cycle (push alone doesn't move pricePerShare; settle does).
// Always returns the snapshot (NAV breakdown + positions + vault share price) for /status.
export async function navCycle(deps: NavCycleDeps): Promise<NavCycleResult> {
  const { sdk, cfg, logger, publicClient, walletClient, account } = deps;

  // Reads use E's address even without a signer (read-only NAV for the dashboard).
  const readAccount = (account ?? (cfg.EXPECTED_EOA as Address)) as Address;
  const bundle = await loadMarkets(sdk);
  const nav = await computeNav({
    sdk,
    publicClient,
    bundle,
    account: readAccount,
    usdc: cfg.USDC_ADDRESS as Address,
    logger,
  });

  const navSnap: StatusNav = {
    navUsd: usdc6ToNumber(nav.navUsdc6),
    idleUsd: usdc6ToNumber(nav.idleUsdc6),
    positionsNetUsd: usdc6ToNumber(nav.positionsNetUsd6),
    pendingCollateralUsd: usdc6ToNumber(nav.pendingCollateralUsd6),
  };
  const positions: StatusPosition[] = nav.positionComponents.map((p) => ({
    symbol: p.symbol,
    isLong: p.isLong,
    sizeUsd: p.sizeUsd,
    netValueUsd: p.netValueUsd,
  }));
  const vaultState = await readVaultState(publicClient, cfg.VAULT_ADDRESS as Address | undefined);

  const base = { navUsdc6: nav.navUsdc6, nav: navSnap, positions, vaultState };

  if (!canBroadcast(cfg) || !cfg.VAULT_ADDRESS || !walletClient) {
    logger.info(
      { navUsdc6: nav.navUsdc6.toString(), dryRun: cfg.DRY_RUN, vault: cfg.VAULT_ADDRESS ?? null },
      "nav-cycle: computed NAV (not pushing — dry-run / no vault / no signer)",
    );
    return { ...base, pushed: false, settled: { deposit: false, redeem: false } };
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

  // Re-read vault state after settle so /status reflects the new share price.
  const after = await readVaultState(publicClient, vault);
  return { ...base, vaultState: after, pushed: true, settled: { deposit: !dep.skipped, redeem: !red.skipped } };
}

async function readVaultState(
  publicClient: PublicClient,
  vault: Address | undefined,
): Promise<StatusVaultState | null> {
  if (!vault) return null;
  try {
    const [totalAssets, totalSupply] = await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
    ]);
    // totalAssets = USDC 6dp, totalSupply = shares 18dp. pps in asset units per share.
    const sharePrice =
      totalSupply > 0n ? usdc6ToNumber(totalAssets) / (Number(totalSupply) / 1e18) : null;
    return { totalAssetsUsd: usdc6ToNumber(totalAssets), totalSupply: totalSupply.toString(), sharePrice };
  } catch {
    return null;
  }
}
