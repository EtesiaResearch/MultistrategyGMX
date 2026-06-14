# Demo script — Etesia GMX

One-liner: *"Etesia's HL-native crypto signals, now executing onchain on GMX/Arbitrum, wrapped in an
institutional ERC-7540 vault with a GMX-aware NAV oracle — built in under a day."*

Prereqs: vault deployed (valuationManager + curator/safe = hot EOA), EOA funded (ETH + USDC),
`HOT_PK` set, USDC approved to the SyntheticsRouter, `DRY_RUN=false`.

## 1. The vault (Lagoon LP page)
Open `https://app.lagoon.finance/vault/42161/<VAULT_ADDRESS>` — real ERC-7540 vault, USDC asset, shares.

## 2. Deposit → settle → shares
- LP `requestDeposit` USDC on the Lagoon page.
- Run a nav-cycle (the service does this every `NAV_CRON`, or trigger once): it pushes NAV and calls
  `settleDeposit` — shares mint, deposit USDC lands in the EOA.
- `pnpm tsx scripts/snapshot.ts` shows totalAssets / share price.

## 3. Trade cycle: signal → GMX position onchain
- With `SIGNAL_SOURCE=mock` the default target is a $15 ETH long; the trade-cycle reconciles it and
  `orders.long` opens a GMX position (keeper fills with the oracle price).
- Show the position on Arbiscan (the EOA address) and on GMX.
- `scripts/snapshot.ts` shows the open position in the NAV breakdown.

## 4. NAV oracle moves share price
- The nav-cycle computes NAV = idle USDC + position net value (+ any pending-order collateral),
  `updateNewTotalAssets`, then `settleDeposit/Redeem`. Share price on the Lagoon page updates to track
  the live GMX portfolio.

## 5. Flip / close → NAV + share price move
- Switch the mock target to `DEMO_FLIP` (short) or `DEMO_FLAT` (close), or point `SIGNAL_SOURCE=hlnative`
  at a running hlnative. The reconciler closes/flips on GMX; NAV and share price move accordingly.
- LP `requestRedeem`; nav-cycle `settleRedeem`; LP claims USDC.

## Live dashboard
- Service `/status` endpoint: last NAV (USD), pushed/settled flags, last trade cycle.
- `pnpm tsx scripts/snapshot.ts`: NAV breakdown + positions + vault share price + LP page URL.
