"use client";

import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { VaultUtils } from "@lagoon-protocol/v0-core";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/vault";

export interface VaultCore {
  totalAssets: bigint;
  totalSupply: bigint;
  /** Assets per ONE share (10^18), in asset decimals — VaultUtils math. */
  pricePerShare: bigint;
  vaultDecimals: number;
  /** The share token symbol. */
  shareSymbol: string;
  assetAddress: Address;
  assetSymbol: string;
  assetDecimals: number;
  decimalsOffset: bigint;
  /** True ⇒ the sync deposit path is currently usable (NAV fresh onchain). */
  isTotalAssetsValid: boolean;
}

const vault = { address: VAULT_ADDRESS, abi: vaultAbi } as const;

/**
 * Live vault state, straight from the chain (the chain is the source of
 * truth). Batched through multicall3 by wagmi; refetches every 30s.
 */
export function useVaultCore(): VaultCore | undefined {
  const { data: vaultData } = useReadContracts({
    contracts: [
      { ...vault, functionName: "asset" },
      { ...vault, functionName: "decimals" },
      { ...vault, functionName: "totalAssets" },
      { ...vault, functionName: "totalSupply" },
      { ...vault, functionName: "isTotalAssetsValid" },
      { ...vault, functionName: "symbol" },
    ],
    allowFailure: false,
    query: { refetchInterval: 30_000 },
  });

  const assetAddress = vaultData?.[0];

  // Static ERC-20 metadata — read once, never refetched.
  const { data: assetData } = useReadContracts({
    contracts: [
      { address: assetAddress as Address, abi: erc20Abi, functionName: "symbol" },
      { address: assetAddress as Address, abi: erc20Abi, functionName: "decimals" },
    ],
    allowFailure: false,
    query: { enabled: assetAddress !== undefined, staleTime: Infinity },
  });

  if (vaultData === undefined || assetData === undefined) return undefined;

  const [asset, vaultDecimals, totalAssets, totalSupply, isTotalAssetsValid, shareSymbol] = vaultData;
  const [assetSymbol, assetDecimals] = assetData;

  const decimalsOffset = VaultUtils.decimalsOffset(assetDecimals);
  const pricePerShare = VaultUtils.convertToAssets(VaultUtils.ONE_SHARE, {
    totalAssets,
    totalSupply,
    decimalsOffset,
  });

  return {
    totalAssets,
    totalSupply,
    pricePerShare,
    vaultDecimals,
    shareSymbol,
    assetAddress: asset,
    assetSymbol,
    assetDecimals,
    decimalsOffset,
    isTotalAssetsValid,
  };
}
