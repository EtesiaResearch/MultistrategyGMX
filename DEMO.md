# Demo script — Etesia GMX

One-liner: *"Etesia's HL-native crypto signals, now executing onchain on GMX/Arbitrum, wrapped in an
institutional ERC-7540 vault with a GMX-aware NAV oracle — built in under a day."*

Prereqs: vault deployed (`0x7f6c5ed71ca969168247958057fcfe06c68ad5a2`, valuationManager + curator/safe
= hot EOA `E` = `0xee94E1A5534A70231DaEE670b51fEC50AC032b6A`), `HOT_PK` set, `DRY_RUN=false`. The boot
startup check asserts HOT_PK controls E and the vault roles resolve to E before anything runs.

## Go-live sequence (do in order)

> **NAV idle = `balanceOf(E)`.** Any USDC sitting on E is counted as vault NAV, so E must hold **zero
> personal USDC** — only ETH for gas + GMX execution fee. (The old "keep ~40–50 USDC on E for
> collateral" note was for a separate-Safe design and is WRONG here: GMX collateral is drawn from the
> already-deposited USDC that settle moves into E.)

1. **E holds 0 personal USDC** — move any personal USDC out to a separate wallet `D`. E keeps only ETH.
   (Boot warns loudly if E holds USDC while the vault is still empty.)
2. **Push first NAV = 0** while the vault is empty (genuinely true now: 0 USDC, 0 positions). The
   `STRICT_FIRST_NAV_ZERO` guard enforces it.
3. **Approve USDC** to the SyntheticsRouter (`0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6`) once.
4. **Deposit from D** (D = the LP, receives shares): `requestDeposit` on the Lagoon page → the
   nav-cycle pushes NAV and `settleDeposit` → USDC lands in E **as vault funds**, shares mint to D.
5. **Flip `DRY_RUN=false`**; GMX collateral now comes from that deposited USDC in E. Never pre-fund E
   with personal USDC. Validate with `pnpm tsx scripts/nav-validation.ts`.

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
