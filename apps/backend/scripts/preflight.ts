// Read-only go-live preflight: prints everything needed to decide A1–A5 safely.
// Run from apps/backend (so .env loads): pnpm tsx scripts/preflight.ts
import { pino } from "pino";
import { formatEther, getAddress, type Address } from "viem";
import { loadConfig } from "../src/config.js";
import { makeAccount, makePublicClient } from "../src/clients.js";
import { usdcAbi } from "../src/abi/usdc.js";
import { vaultAbi } from "../src/abi/vault.js";
import { usdc6ToNumber } from "../src/gmx/converters.js";

const logger = pino({ transport: { target: "pino-pretty" } });

async function readOr<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const account = makeAccount(cfg);
  const pc = makePublicClient(cfg);
  const E = getAddress(cfg.EXPECTED_EOA);
  const vault = getAddress(cfg.VAULT_ADDRESS as string);
  const usdc = cfg.USDC_ADDRESS as Address;

  logger.info(
    { hasKey: !!account, keyAddress: account?.address ?? null, expectedE: E, keyControlsE: account ? getAddress(account.address) === E : false },
    "A2 — HOT_PK",
  );

  const [eth, eUsdc] = await Promise.all([
    pc.getBalance({ address: E }),
    pc.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [E] }),
  ]);
  logger.info(
    { ethBalance: formatEther(eth), usdcBalance: usdc6ToNumber(eUsdc), note: "A1 wants usdcBalance=0; need ETH for gas+execFee" },
    "E balances",
  );

  const [owner, safe, asset, totalSupply, totalAssets] = await Promise.all([
    readOr(pc.readContract({ address: vault, abi: vaultAbi, functionName: "owner" })),
    readOr(pc.readContract({ address: vault, abi: vaultAbi, functionName: "safe" })),
    readOr(pc.readContract({ address: vault, abi: vaultAbi, functionName: "asset" })),
    readOr(pc.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" })),
    readOr(pc.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" })),
  ]);
  logger.info(
    {
      vault,
      owner,
      safe,
      asset,
      ownerIsE: owner ? getAddress(owner as string) === E : null,
      safeIsE: safe ? getAddress(safe as string) === E : null,
      assetIsUsdc: asset ? getAddress(asset as string) === getAddress(usdc) : null,
      totalSupply: totalSupply?.toString() ?? null,
      totalAssets: totalAssets != null ? usdc6ToNumber(totalAssets as bigint) : null,
      firstNavZeroEligible: totalSupply === 0n,
    },
    "vault state",
  );

  logger.info(
    {
      A1_eHoldsZeroUsdc: eUsdc === 0n,
      A3_canApprove: !!account && eth > 0n,
      A4_pushFirstNavZero: totalSupply === 0n,
      A5_navValidationNeedsUsdcOnE: eUsdc > 0n ? "fundable" : "BLOCKED: E has 0 USDC — deposit+settle first",
    },
    "go-live readiness",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
