import type { Logger } from "pino";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { vaultAbi } from "../abi/vault.js";

// Settle adapted from etesia-curator but WITHOUT Zodiac: the Lagoon curator/safe
// role is set to our hot EOA, so settleDeposit/settleRedeem (onlySafe) are direct
// EOA calls. settle is what actually moves pricePerShare (commits the pending NAV),
// so it must run in the same cycle as the push.
export type SettleKind = "deposit" | "redeem";

export class SettleError extends Error {
  override readonly cause: unknown;
  readonly kind: SettleKind;
  constructor(message: string, opts: { cause?: unknown; kind: SettleKind }) {
    super(message);
    this.name = "SettleError";
    this.cause = opts.cause;
    this.kind = opts.kind;
  }
}

export interface SettleDeps {
  publicClient: PublicClient;
  walletClient: Pick<WalletClient, "account" | "chain" | "writeContract">;
  vault: Address;
  logger?: Logger;
}

export interface SettleResult {
  kind: SettleKind;
  skipped: boolean; // true when there was nothing to settle (simulation reverted)
  txHash?: Hex;
  blockNumber?: bigint;
  gasUsed?: bigint;
}

const RECEIPT_TIMEOUT_MS = 60_000;
function fnFor(kind: SettleKind): "settleDeposit" | "settleRedeem" {
  return kind === "deposit" ? "settleDeposit" : "settleRedeem";
}

export const settleDeposit = (d: SettleDeps, nav: bigint) => executeSettle(d, nav, "deposit");
export const settleRedeem = (d: SettleDeps, nav: bigint) => executeSettle(d, nav, "redeem");

async function executeSettle(deps: SettleDeps, nav: bigint, kind: SettleKind): Promise<SettleResult> {
  const account = deps.walletClient.account;
  if (!account) throw new SettleError("walletClient has no account", { kind });
  const functionName = fnFor(kind);

  // Simulate first: a revert here usually means "nothing pending to settle" — skip
  // rather than burn gas. (We can't cheaply distinguish that from a real failure,
  // so we treat all simulation reverts as skip + log.)
  try {
    await deps.publicClient.simulateContract({
      account,
      address: deps.vault,
      abi: vaultAbi,
      functionName,
      args: [nav],
    });
  } catch (err) {
    deps.logger?.debug({ kind, reason: String(err).slice(0, 200) }, "settle skipped (simulation reverted)");
    return { kind, skipped: true };
  }

  let txHash: Hex;
  try {
    txHash = await deps.walletClient.writeContract({
      account,
      chain: deps.walletClient.chain ?? null,
      address: deps.vault,
      abi: vaultAbi,
      functionName,
      args: [nav],
    });
  } catch (err) {
    throw new SettleError(`writeContract failed for ${functionName}(${nav})`, { cause: err, kind });
  }

  const receipt = await deps.publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== "success") throw new SettleError(`tx failed: ${txHash}`, { kind });
  deps.logger?.info({ kind, txHash }, "settled");
  return { kind, skipped: false, txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}
