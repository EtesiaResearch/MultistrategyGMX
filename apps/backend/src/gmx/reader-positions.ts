import SyntheticsReaderAbi from "@gmx-io/sdk/abis/SyntheticsReader";
import type { Abi, Address, PublicClient } from "viem";
import { withRetry } from "../util/retry.js";

// On-chain ground truth for open positions via the GMX Reader. Unlike the SDK's
// getPositionsInfo (which derives/values positions and silently drops any whose tokens
// it couldn't price), this reads the raw Position.Props from DataStore — no prices
// needed, so it never drops a position. We use it to know how many positions REALLY
// exist, and cross-check the SDK's read so we never act on a partial view (which would
// cause duplicate opens or missed closes).
export interface OnchainPosition {
  market: Address;
  collateralToken: Address;
  sizeInUsd: bigint; // 1e30
  isLong: boolean;
}

interface RawProps {
  addresses: { account: Address; market: Address; collateralToken: Address };
  numbers: { sizeInUsd: bigint };
  flags: { isLong: boolean };
}

export async function getAccountPositionsOnchain(
  publicClient: PublicClient,
  reader: Address,
  dataStore: Address,
  account: Address,
): Promise<OnchainPosition[]> {
  const res = (await withRetry(() =>
    publicClient.readContract({
      address: reader,
      abi: SyntheticsReaderAbi as unknown as Abi,
      functionName: "getAccountPositions",
      args: [dataStore, account, 0n, 1000n],
    }),
  )) as readonly RawProps[];

  return res
    .filter((p) => p.numbers.sizeInUsd > 0n)
    .map((p) => ({
      market: p.addresses.market,
      collateralToken: p.addresses.collateralToken,
      sizeInUsd: p.numbers.sizeInUsd,
      isLong: p.flags.isLong,
    }));
}
