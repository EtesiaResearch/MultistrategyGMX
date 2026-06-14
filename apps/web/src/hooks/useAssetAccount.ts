"use client";

import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { VAULT_ADDRESS } from "@/lib/vault";

export interface AssetAccount {
  /** Wallet balance of the vault's underlying asset. */
  balance: bigint;
  /** Current allowance granted to the vault. */
  allowance: bigint;
}

/** Wallet balance + vault allowance for the underlying asset (30s refetch). */
export function useAssetAccount(
  owner: Address | undefined,
  asset: Address | undefined,
): AssetAccount | undefined {
  const { data } = useReadContracts({
    contracts: [
      {
        address: asset as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner as Address],
      },
      {
        address: asset as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner as Address, VAULT_ADDRESS],
      },
    ],
    allowFailure: false,
    query: { enabled: owner !== undefined && asset !== undefined, refetchInterval: 30_000 },
  });

  if (data === undefined) return undefined;
  return { balance: data[0], allowance: data[1] };
}
