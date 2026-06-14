"use client";

import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/vault";

export interface UserPosition {
  /** Claimed shares in the wallet (ERC-20 balance). */
  balance: bigint;
  /** Shares settled but not yet claimed — `maxMint(controller)`. */
  claimableShares: bigint;
  /** Assets of a deposit request awaiting settlement. */
  pendingDepositAssets: bigint;
  /** Assets of a settled deposit claimable via `deposit`/`mint`. */
  claimableDepositAssets: bigint;
  /** Shares of a redeem request awaiting settlement. */
  pendingRedeemShares: bigint;
  /** Shares of a settled redeem claimable via `withdraw`/`redeem`. */
  claimableRedeemShares: bigint;
  /** Assets withdrawable right now — `maxWithdraw(controller)`. */
  maxWithdrawAssets: bigint;
  /**
   * Lagoon user-position formula:
   * balanceOf + maxMint + pendingRedeemRequest(0, user).
   */
  totalShares: bigint;
}

const vault = { address: VAULT_ADDRESS, abi: vaultAbi } as const;

/**
 * The connected user's full position. `requestId = 0` is the ERC-7540
 * wildcard for "the controller's current request" (one open request per
 * controller — ABI error `OnlyOneRequestAllowed`). Refetches every 30s; reads
 * go through our RPC transport regardless of the wallet's chain.
 */
export function useUserPosition(address: Address | undefined): UserPosition | undefined {
  const user = address as Address;
  const { data } = useReadContracts({
    contracts: [
      { ...vault, functionName: "balanceOf", args: [user] },
      { ...vault, functionName: "maxMint", args: [user] },
      { ...vault, functionName: "pendingDepositRequest", args: [0n, user] },
      { ...vault, functionName: "claimableDepositRequest", args: [0n, user] },
      { ...vault, functionName: "pendingRedeemRequest", args: [0n, user] },
      { ...vault, functionName: "claimableRedeemRequest", args: [0n, user] },
      { ...vault, functionName: "maxWithdraw", args: [user] },
    ],
    allowFailure: false,
    query: { enabled: address !== undefined, refetchInterval: 30_000 },
  });

  if (address === undefined || data === undefined) return undefined;

  const [
    balance,
    claimableShares,
    pendingDepositAssets,
    claimableDepositAssets,
    pendingRedeemShares,
    claimableRedeemShares,
    maxWithdrawAssets,
  ] = data;

  return {
    balance,
    claimableShares,
    pendingDepositAssets,
    claimableDepositAssets,
    pendingRedeemShares,
    claimableRedeemShares,
    maxWithdrawAssets,
    totalShares: balance + claimableShares + pendingRedeemShares,
  };
}
