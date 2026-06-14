// A4 — push the first NAV = 0 while the vault is empty (Lagoon hard invariant).
// Aborts if the vault already has shares. Run from apps/backend: pnpm tsx scripts/push-first-nav-zero.ts
import { pino } from "pino";
import { getAddress, type Address } from "viem";
import { loadConfig } from "../src/config.js";
import { makeAccount, makePublicClient, makeWalletClient } from "../src/clients.js";
import { vaultAbi } from "../src/abi/vault.js";
import { pushNav } from "../src/nav/push.js";

const logger = pino({ transport: { target: "pino-pretty" } });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const account = makeAccount(cfg);
  const wallet = makeWalletClient(cfg);
  const pc = makePublicClient(cfg);
  if (!account || !wallet) throw new Error("HOT_PK not set — cannot push NAV");
  const vault = getAddress(cfg.VAULT_ADDRESS as string) as Address;

  const totalSupply = await pc.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" });
  if (totalSupply !== 0n) {
    throw new Error(`vault already has shares (totalSupply=${totalSupply}). This is NOT a first NAV. Aborting.`);
  }

  logger.info({ vault }, "A4 — pushing first NAV = 0 (updateNewTotalAssets(0))");
  const res = await pushNav(
    {
      publicClient: pc,
      walletClient: wallet,
      vault,
      logger,
      strictFirstNavZero: cfg.STRICT_FIRST_NAV_ZERO,
      navDivergenceMaxBps: cfg.NAV_DIVERGENCE_MAX_BPS,
    },
    0n,
  );
  logger.info(
    { txHash: res.txHash, gasUsed: res.gasUsed.toString(), arbiscan: `https://arbiscan.io/tx/${res.txHash}` },
    "A4 done — first NAV = 0 pushed",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
