// One-shot status dashboard for the demo: prints GMX-aware NAV breakdown, open
// positions, and (if VAULT_ADDRESS set) Lagoon vault state + share price.
// Run: HOT_PK=0x... pnpm tsx scripts/snapshot.ts
import { pino } from "pino";
import type { Address } from "viem";
import { loadConfig } from "../src/config.js";
import { makeAccount, makePublicClient } from "../src/clients.js";
import { makeGmxSdk } from "../src/gmx/sdk.js";
import { loadMarkets } from "../src/gmx/markets.js";
import { computeNav } from "../src/nav/compute.js";
import { usdc6ToNumber } from "../src/gmx/converters.js";
import { vaultAbi } from "../src/abi/vault.js";

const logger = pino({ transport: { target: "pino-pretty" } });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const account = makeAccount(cfg);
  if (!account) throw new Error("set HOT_PK to snapshot (need an account address)");
  const sdk = makeGmxSdk(cfg);
  const publicClient = makePublicClient(cfg);
  const bundle = await loadMarkets(sdk);

  const nav = await computeNav({
    sdk,
    publicClient,
    bundle,
    account: account.address as Address,
    usdc: cfg.USDC_ADDRESS as Address,
    logger,
  });

  logger.info(
    {
      navUsd: usdc6ToNumber(nav.navUsdc6),
      idleUsd: usdc6ToNumber(nav.idleUsdc6),
      positionsNetUsd: usdc6ToNumber(nav.positionsNetUsd6),
      pendingCollateralUsd: usdc6ToNumber(nav.pendingCollateralUsd6),
      positions: nav.positionComponents,
    },
    "GMX-aware NAV",
  );

  if (cfg.VAULT_ADDRESS) {
    const vault = cfg.VAULT_ADDRESS as Address;
    const [totalAssets, totalSupply] = await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
    ]);
    // totalAssets = USDC 6dp, totalSupply = shares 18dp → asset units per share.
    const pps = totalSupply > 0n ? usdc6ToNumber(totalAssets) / (Number(totalSupply) / 1e18) : null;
    logger.info(
      {
        vault,
        totalAssetsUsd: usdc6ToNumber(totalAssets),
        totalSupply: totalSupply.toString(),
        pricePerShare: pps,
        lpPage: `https://app.lagoon.finance/vault/${cfg.CHAIN_ID}/${vault}`,
      },
      "Lagoon vault",
    );
  } else {
    logger.info("VAULT_ADDRESS not set — skipping Lagoon vault state");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
