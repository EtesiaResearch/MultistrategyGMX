// One-shot manual settle: compute NAV -> updateNewTotalAssets(nav) -> settleDeposit/Redeem(nav).
// Run AFTER an LP requestDeposit is pending in the Silo. Settles it at the current share price
// (first deposit on the empty vault → NAV 0 → priced 1:1). Bypasses DRY_RUN (deliberate manual op).
// Run from apps/backend: pnpm tsx scripts/settle-once.ts
import { pino } from "pino";
import { getAddress, type Address } from "viem";
import { loadConfig } from "../src/config.js";
import { makeAccount, makePublicClient, makeWalletClient } from "../src/clients.js";
import { makeGmxSdk } from "../src/gmx/sdk.js";
import { loadMarkets } from "../src/gmx/markets.js";
import { computeNav } from "../src/nav/compute.js";
import { pushNav } from "../src/nav/push.js";
import { settleDeposit, settleRedeem } from "../src/settle/execute.js";
import { usdc6ToNumber } from "../src/gmx/converters.js";
import { vaultAbi } from "../src/abi/vault.js";

const logger = pino({ transport: { target: "pino-pretty" } });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const account = makeAccount(cfg);
  const wallet = makeWalletClient(cfg);
  const pc = makePublicClient(cfg);
  if (!account || !wallet) throw new Error("HOT_PK not set — cannot settle");
  const vault = getAddress(cfg.VAULT_ADDRESS as string) as Address;

  const sdk = makeGmxSdk(cfg);
  const bundle = await loadMarkets(sdk);
  const nav = await computeNav({
    sdk,
    publicClient: pc,
    bundle,
    account: account.address as Address,
    usdc: cfg.USDC_ADDRESS as Address,
    logger,
  });
  logger.info({ navUsd: usdc6ToNumber(nav.navUsdc6) }, "current AUM (excludes pending Silo deposit)");

  const pushRes = await pushNav(
    {
      publicClient: pc,
      walletClient: wallet,
      vault,
      logger,
      strictFirstNavZero: cfg.STRICT_FIRST_NAV_ZERO,
      navDivergenceMaxBps: cfg.NAV_DIVERGENCE_MAX_BPS,
    },
    nav.navUsdc6,
  );
  logger.info({ txHash: pushRes.txHash }, "updateNewTotalAssets pushed");

  const settleDeps = { publicClient: pc, walletClient: wallet, vault, logger };
  const dep = await settleDeposit(settleDeps, nav.navUsdc6);
  const red = await settleRedeem(settleDeps, nav.navUsdc6);

  const [totalSupply, totalAssets] = await Promise.all([
    pc.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
    pc.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
  ]);
  logger.info(
    {
      settledDeposit: dep.skipped ? "skipped (nothing pending)" : dep.txHash,
      settledRedeem: red.skipped ? "skipped (nothing pending)" : red.txHash,
      vaultTotalSupplyShares: (Number(totalSupply) / 1e18).toString(),
      vaultTotalAssetsUsd: usdc6ToNumber(totalAssets),
    },
    "settle-once done",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
