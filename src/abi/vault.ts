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
  // Role / asset getters for the fail-fast startup check. `owner` (Ownable2Step)
  // and `safe` (curator) are reliable; `valuationManager`/`getRolesStorage`/
  // `pendingSilo` are best-effort (older deploys revert — caught and tolerated).
  { type: "function", name: "owner", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "safe", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "asset", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "valuationManager", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "pendingSilo", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  {
    type: "function",
    name: "getRolesStorage",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "whitelistManager", type: "address" },
          { name: "feeReceiver", type: "address" },
          { name: "safe", type: "address" },
          { name: "feeRegistry", type: "address" },
          { name: "valuationManager", type: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;
