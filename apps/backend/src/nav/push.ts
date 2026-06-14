import type { Logger } from "pino";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { vaultAbi } from "../abi/vault.js";

// Ported from etesia-curator/src/nav/push.ts. Two production guards before any
// onchain write:
//   (1) STRICT_FIRST_NAV_ZERO — first NAV on an empty vault (totalSupply==0) must
//       be 0 (Lagoon hard invariant; violating it permanently breaks accounting).
//   (2) NAV_DIVERGENCE_MAX_BPS — caps pricePerShare swing per cycle.
export class NavSanityError extends Error {
  readonly details: Record<string, string>;
  constructor(reason: string, details: Record<string, string>) {
    super(reason);
    this.name = "NavSanityError";
    this.details = details;
  }
}

export class NavPushError extends Error {
  override readonly cause: unknown;
  readonly nav: bigint;
  constructor(message: string, opts: { cause?: unknown; nav: bigint }) {
    super(message);
    this.name = "NavPushError";
    this.cause = opts.cause;
    this.nav = opts.nav;
  }
}

const RECEIPT_TIMEOUT_MS = 60_000;
const ONE_18 = 10n ** 18n;
const BPS_DENOM = 10_000n;

export interface SanityCheckInput {
  logger?: Logger;
  strictFirstNavZero: boolean;
  navDivergenceMaxBps: number;
  totalSupply: bigint;
  totalAssets: bigint;
  newNav: bigint;
}

// Pure pre-flight check. Throws NavSanityError when a guard is violated.
export function sanityCheckNav(input: SanityCheckInput): void {
  const { logger, strictFirstNavZero, navDivergenceMaxBps, totalSupply, totalAssets, newNav } = input;

  if (strictFirstNavZero && totalSupply === 0n && newNav > 0n) {
    const details = {
      totalSupply: totalSupply.toString(),
      attemptedNav: newNav.toString(),
      hint: "First NAV on an empty vault must be 0 (Lagoon invariant).",
    };
    logger?.error({ reason: "FIRST_NAV_MUST_BE_ZERO", ...details }, "NAV guard: empty-vault first push");
    throw new NavSanityError("FIRST_NAV_MUST_BE_ZERO", details);
  }

  if (totalSupply > 0n && totalAssets > 0n) {
    const currentPps = (totalAssets * ONE_18) / totalSupply;
    const newPps = (newNav * ONE_18) / totalSupply;
    const ratioBps = (newPps * BPS_DENOM) / currentPps;
    const maxBps = BigInt(navDivergenceMaxBps);
    const upperBound = BPS_DENOM + maxBps;
    const lowerBound = BPS_DENOM > maxBps ? BPS_DENOM - maxBps : 0n;
    if (ratioBps > upperBound || ratioBps < lowerBound) {
      const details = {
        ratioBps: ratioBps.toString(),
        maxBps: maxBps.toString(),
        currentTotalAssets: totalAssets.toString(),
        newTotalAssets: newNav.toString(),
      };
      logger?.error({ reason: "NAV_DIVERGENCE_EXCEEDED", ...details }, "NAV guard: divergence");
      throw new NavSanityError("NAV_DIVERGENCE_EXCEEDED", details);
    }
  }
}

export interface PushNavDeps {
  publicClient: PublicClient;
  walletClient: Pick<WalletClient, "account" | "chain" | "writeContract">;
  vault: Address;
  logger?: Logger;
  strictFirstNavZero: boolean;
  navDivergenceMaxBps: number;
}

export interface PushNavResult {
  txHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
}

// Read vault state for the guards, then push the proposed NAV (USDC 6dp) via
// updateNewTotalAssets. Does NOT move pricePerShare on its own — settle does.
export async function pushNav(deps: PushNavDeps, nav: bigint): Promise<PushNavResult> {
  const account = deps.walletClient.account;
  if (!account) throw new NavPushError("walletClient has no account", { nav });

  const [totalSupply, totalAssets] = await Promise.all([
    deps.publicClient.readContract({ address: deps.vault, abi: vaultAbi, functionName: "totalSupply" }),
    deps.publicClient.readContract({ address: deps.vault, abi: vaultAbi, functionName: "totalAssets" }),
  ]);

  sanityCheckNav({
    strictFirstNavZero: deps.strictFirstNavZero,
    navDivergenceMaxBps: deps.navDivergenceMaxBps,
    totalSupply,
    totalAssets,
    newNav: nav,
    ...(deps.logger ? { logger: deps.logger } : {}),
  });

  try {
    await deps.publicClient.simulateContract({
      account,
      address: deps.vault,
      abi: vaultAbi,
      functionName: "updateNewTotalAssets",
      args: [nav],
    });
  } catch (err) {
    throw new NavPushError(`simulation reverted for updateNewTotalAssets(${nav})`, { cause: err, nav });
  }

  let txHash: Hex;
  try {
    txHash = await deps.walletClient.writeContract({
      account,
      chain: deps.walletClient.chain ?? null,
      address: deps.vault,
      abi: vaultAbi,
      functionName: "updateNewTotalAssets",
      args: [nav],
    });
  } catch (err) {
    throw new NavPushError(`writeContract failed for updateNewTotalAssets(${nav})`, { cause: err, nav });
  }

  const receipt = await deps.publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== "success") {
    throw new NavPushError(`tx failed onchain: ${txHash}`, { nav });
  }
  return { txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}
