"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

export type TxStatus = "idle" | "wallet" | "mining" | "success" | "error";

export interface TxFlow {
  status: TxStatus;
  hash: `0x${string}` | undefined;
  /** Wallet/RPC error message, verbatim — never swallowed. */
  error: string | undefined;
  send: (params: Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0]) => void;
  reset: () => void;
}

/**
 * One transaction lifecycle: wallet signature → receipt → refetch.
 * On a successful receipt every active query (onchain reads, balances,
 * allowances) is invalidated so the UI converges on the new chain state.
 * A reverted receipt is an error, not a success.
 */
export function useTxFlow(): TxFlow {
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const [walletPending, setWalletPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const receipt = useWaitForTransactionReceipt({
    hash: hash as `0x${string}`,
    query: { enabled: hash !== undefined },
  });

  const reverted = receipt.data?.status === "reverted";
  useEffect(() => {
    if (receipt.data === undefined) return;
    if (receipt.data.status === "success") {
      void queryClient.invalidateQueries();
    }
  }, [receipt.data, queryClient]);

  let status: TxStatus = "idle";
  if (error !== undefined || reverted) status = "error";
  else if (walletPending) status = "wallet";
  else if (hash !== undefined && receipt.data === undefined) status = "mining";
  else if (receipt.data?.status === "success") status = "success";

  return {
    status,
    hash,
    error: error ?? (reverted ? "Transaction reverted onchain." : undefined),
    send: (params) => {
      setError(undefined);
      setHash(undefined);
      setWalletPending(true);
      writeContractAsync(params)
        .then((h) => setHash(h))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setWalletPending(false));
    },
    reset: () => {
      setHash(undefined);
      setError(undefined);
      setWalletPending(false);
    },
  };
}
