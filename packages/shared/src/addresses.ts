// Single source of truth for chain + canonical addresses (backend + web import these).
export const CHAIN_ID = 42161 as const; // Arbitrum One

// Lagoon vault (deployed; both valuationManager and curator/safe = E).
export const VAULT_ADDRESS = "0x7f6c5ed71ca969168247958057fcfe06c68ad5a2";
// E — single hot EOA = GMX trader = valuationManager = curator/safe.
export const EXPECTED_EOA = "0xee94E1A5534A70231DaEE670b51fEC50AC032b6A";

export const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // native USDC (6dp)
export const WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // WETH (18dp)

export const ARBISCAN_URL = "https://arbiscan.io";
export const LAGOON_LP_URL = `https://app.lagoon.finance/vault/${CHAIN_ID}/${VAULT_ADDRESS}`;
