# Lagoon cheat-sheet (Arbitrum One, v0.5.x)

> Verified 2026-06-14 against docs.lagoon.finance + hopperlabsxyz/lagoon-v0 (v0.5.1).

## Packages
- `@lagoon-protocol/v0-core`, `@lagoon-protocol/v0-viem` (the `Vault` class wraps reads + helpers).
  Already used by etesia-curator (v0-core ^0.19.10, v0-viem ^0.18.7).

## Architecture
Vault (ERC-7540 + ERC-20 shares) + Silo (holds pending deposits/redeems) + Safe (custody/curator).
LP page: `https://app.lagoon.finance/vault/42161/<VAULT_ADDRESS>`.
Arbitrum factory: `0x9De724B0efEe0FbA07FE21a16B9Bf9bBb5204Fb4`.

## Roles
- `valuationManager` → `updateNewTotalAssets(uint256)` — stores a pending NAV (does NOT move price).
- `safe` (curator) → `settleDeposit(uint256)` / `settleRedeem(uint256)` — **onlySafe**; commits NAV,
  takes fees, mints/burns shares, moves assets Silo↔Safe.
- **OUR SETUP:** valuationManager == safe == our single hot EOA → all three are plain EOA calls.
  No Zodiac, no Safe-tx-building. Set both roles to the EOA at deploy.

## Critical sequencing
`updateNewTotalAssets` alone does NOT change pricePerShare — only `settleDeposit/Redeem` does
(it calls `_updateTotalAssetsAndTakeFees`). **Push + settle must run in the same cycle.**

## Units
`newTotalAssets` is in the asset's decimals → **USDC 6dp**. Convert GMX 1e30 USD → 6dp before pushing.

## Hard invariants (guards already in nav/push.ts::sanityCheckNav)
- **First NAV on an empty vault (totalSupply==0) MUST be 0** (`STRICT_FIRST_NAV_ZERO`). Cold-start:
  `scripts/push-first-nav-zero.ts`.
- pricePerShare divergence cap per cycle (`NAV_DIVERGENCE_MAX_BPS`, default 1000 = 10%).
- Never send USDC directly to the Safe — deposits go through requestDeposit → settle.

## ERC-7540 lifecycle
- Deposit: `requestDeposit(assets, controller, owner)` → settleDeposit → claim `deposit`/`mint`.
- Redeem: `requestRedeem(shares, controller, owner)` → settleRedeem → claim `redeem`/`withdraw`.
- Assets pending in Silo before settle; pulled to Safe (our EOA) after settleDeposit.

## Reads (for dashboard / guards)
`totalAssets()`, `totalSupply()`, `convertToAssets(shares)`, pending/claimable request getters.
Use the `Vault` class from `@lagoon-protocol/v0-viem` (`Vault.fetch(addr, publicClient)`).
