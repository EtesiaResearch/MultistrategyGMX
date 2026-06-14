// A3 — approve USDC to the GMX SyntheticsRouter (the contract that pulls collateral).
// One-time; the SDK assumes pre-approval. Run from apps/backend: pnpm tsx scripts/approve-usdc.ts
import { pino } from "pino";
import { getAddress, maxUint256, type Address } from "viem";
import { loadConfig } from "../src/config.js";
import { makeAccount, makePublicClient, makeWalletClient } from "../src/clients.js";
import { usdcAbi } from "../src/abi/usdc.js";
import { usdc6ToNumber } from "../src/gmx/converters.js";

const logger = pino({ transport: { target: "pino-pretty" } });

async function main(): Promise<void> {
  const cfg = loadConfig();
  const account = makeAccount(cfg);
  const wallet = makeWalletClient(cfg);
  const pc = makePublicClient(cfg);
  if (!account || !wallet) throw new Error("HOT_PK not set — cannot approve");

  const usdc = cfg.USDC_ADDRESS as Address;
  const router = getAddress(cfg.GMX_ROUTER); // SyntheticsRouter (approvals go here)

  const current = await pc.readContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "allowance",
    args: [account.address, router],
  });
  logger.info({ router, currentAllowanceUsdc: usdc6ToNumber(current) }, "A3 — current USDC allowance");

  // Unlimited approval (standard for GMX automation). Actual exposure is capped by the
  // wallet's USDC balance. For real prod, scope this to a bounded amount.
  if (current >= maxUint256 / 2n) {
    logger.info("allowance already effectively unlimited — skipping");
    return;
  }

  await pc.simulateContract({
    account,
    address: usdc,
    abi: usdcAbi,
    functionName: "approve",
    args: [router, maxUint256],
  });
  const hash = await wallet.writeContract({
    account,
    chain: wallet.chain,
    address: usdc,
    abi: usdcAbi,
    functionName: "approve",
    args: [router, maxUint256],
  });
  logger.info({ hash }, "approve tx broadcast — waiting for receipt");
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  logger.info({ hash, status: receipt.status, arbiscan: `https://arbiscan.io/tx/${hash}` }, "A3 done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
