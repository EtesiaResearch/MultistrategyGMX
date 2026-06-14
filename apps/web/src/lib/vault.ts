import type { Address } from "viem";
import { vaultAbi_v0_6_0 } from "@lagoon-protocol/v0-core";
import { VAULT_ADDRESS as SHARED_VAULT_ADDRESS } from "@etesia/shared";

/**
 * The Lagoon vault proxy (ERC-7540 share token) — the ONLY contract deposits
 * and withdrawals go through. Never the Safe: direct transfers to the Safe are
 * counted as trading profit and mint performance fees.
 *
 * Defaults to the deployed Arbitrum vault from `@etesia/shared`; override with
 * NEXT_PUBLIC_VAULT_ADDRESS only to point at a different deployment.
 */
export const VAULT_ADDRESS: Address = (() => {
  const raw = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? SHARED_VAULT_ADDRESS;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error("VAULT_ADDRESS is not a 0x-prefixed address");
  }
  return raw.toLowerCase() as Address;
})();

/** The deployed vault reports `version() = "v0.6.0"` (onchain-read 2026-06-14). */
export const vaultAbi = vaultAbi_v0_6_0;
