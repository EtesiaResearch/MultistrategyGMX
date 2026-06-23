import type { GmxSdk } from "@gmx-io/sdk";
import type { StatusGas, StatusNav, StatusPosition, StatusVaultState } from "@etesia/shared";
import type { Logger } from "pino";
import { formatEther, parseEther, type Address, type PublicClient, type WalletClient } from "viem";
import { vaultAbi } from "../abi/vault.js";
import { canBroadcast, type Config } from "../config.js";
import { usdc6ToNumber } from "../gmx/converters.js";
import { loadMarkets } from "../gmx/markets.js";
import { computeNav } from "../nav/compute.js";
import { pushNav } from "../nav/push.js";
import { withRetry } from "../util/retry.js";
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
  gas: StatusGas;
}

// One NAV cycle: compute GMX-aware NAV -> (live) push it to Lagoon -> settle deposit
// & redeem in the SAME cycle (push alone doesn't move pricePerShare; settle does).
// Always returns the snapshot (NAV breakdown + positions + vault share price) for /status.
export async function navCycle(deps: NavCycleDeps): Promise<NavCycleResult> {
  const { sdk, cfg, logger, publicClient, walletClient, account } = deps;

  // Reads use E's address even without a signer (read-only NAV for the dashboard).
  const readAccount = (account ?? (cfg.EXPECTED_EOA as Address)) as Address;

  // Read-only preamble (GMX markets + NAV from on-chain positions). Both are pure
  // reads with no side effects, so retrying the whole block is safe and idempotent.
  // A single transient GMX-API/RPC blip (e.g. "/markets: Premature close") must not
  // forfeit the cycle — especially on a slow (once-daily) NAV_CRON where the next
  // attempt is 24h away. ~31s of backoff (1+2+4+8+16s) rides out a brief outage.
  // Everything AFTER this — pushNav/settle — has on-chain side effects and is
  // deliberately NOT retried here (each has its own simulate-then-write guard).
  const nav = await withRetry(
    async () => {
      const bundle = await loadMarkets(sdk, logger);
      return computeNav({
        sdk,
        publicClient,
        bundle,
        account: readAccount,
        usdc: cfg.USDC_ADDRESS as Address,
        logger,
      });
    },
    { tries: 6, baseMs: 1000 },
  );

  const navSnap: StatusNav = {
    navUsd: usdc6ToNumber(nav.navUsdc6),
    idleUsd: usdc6ToNumber(nav.idleUsdc6),
    positionsNetUsd: usdc6ToNumber(nav.positionsNetUsd6),
    pendingCollateralUsd: usdc6ToNumber(nav.pendingCollateralUsd6),
  };
  const positions: StatusPosition[] = nav.positionComponents;
  const vaultState = await readVaultState(publicClient, cfg.VAULT_ADDRESS as Address | undefined);

  // Gas watchdog — the bot dies silently when E runs out of ETH (gas + GMX exec fees).
  const ethWei = await publicClient.getBalance({ address: readAccount });
  const gas: StatusGas = {
    ethBalance: Number(formatEther(ethWei)),
    low: ethWei < parseEther(String(cfg.GAS_MIN_ETH)),
  };
  if (gas.low) {
    logger.warn(
      { ethBalance: gas.ethBalance, minEth: cfg.GAS_MIN_ETH, account: readAccount },
      "GAS LOW: E is running out of ETH — NAV pushes and GMX orders will start failing. Top up.",
    );
  }

  const base = { navUsdc6: nav.navUsdc6, nav: navSnap, positions, vaultState, gas };

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

  // settleDeposit commits the proposed NAV and settles BOTH pending deposits AND redeems
  // (and re-prices when nothing is pending). Calling settleRedeem afterwards would try to
  // re-commit an already-consumed NAV and REVERT — so only fall back to settleRedeem when
  // the deposit settle itself couldn't run. (Each self-skips if its simulation reverts.)
  const settleDeps = { publicClient, walletClient, vault, logger };
  const dep = await settleDeposit(settleDeps, nav.navUsdc6);
  let redeemSettled = false;
  if (dep.skipped) {
    const red = await settleRedeem(settleDeps, nav.navUsdc6);
    redeemSettled = !red.skipped;
  }

  // Re-read vault state after settle so /status reflects the new share price.
  const after = await readVaultState(publicClient, vault);
  return { ...base, vaultState: after, pushed: true, settled: { deposit: !dep.skipped, redeem: redeemSettled } };
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
