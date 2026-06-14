// Lagoon v0.5.x vault ABI subset (Arbitrum).
// updateNewTotalAssets: onlyValuationManager — stores a pending NAV (does NOT move pricePerShare).
// settleDeposit/settleRedeem: onlySafe (curator) — commits the NAV and mints/burns shares.
// We set valuationManager AND safe to the same hot EOA, so all three are plain EOA calls.
export const vaultAbi = [
  {
    type: "function",
    name: "updateNewTotalAssets",
    inputs: [{ name: "newTotalAssets", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleDeposit",
    inputs: [{ name: "newTotalAssets", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleRedeem",
    inputs: [{ name: "newTotalAssets", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Reads for the NAV sanity guards + dashboard.
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAssets",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
