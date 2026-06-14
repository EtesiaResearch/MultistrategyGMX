# GMX V2 cheat-sheet (Arbitrum One)

> Verified 2026-06-14 against `@gmx-io/sdk@1.6.3` configs, `gmx-io/gmx-synthetics`, docs.gmx.io,
> and the live tickers API. **Re-verify addresses against the installed SDK config before any tx.**

## SDK
- `@gmx-io/sdk@1.6.3` (active, depends on viem ^2.37). Adopted.
- Init: `new GmxSdk({ chainId: 42161, rpcUrl, oracleUrl: "https://arbitrum-api.gmxinfra.io", publicClient, walletClient })`
- Markets: `await sdk.markets.getMarketsInfo()` → `{ marketsInfoData, tokensData }`
- Helpers: `sdk.orders.long({...})`, `sdk.orders.short({...})`, `sdk.orders.createIncreaseOrder({...})`

## Contracts (Arbitrum One)
| Contract | Address |
|---|---|
| ExchangeRouter | `0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41` |
| SyntheticsRouter (token approvals go HERE) | `0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6` |
| OrderVault | `0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5` |
| DataStore | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` |
| Reader (SyntheticsReader) | `0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789` |
| ReferralStorage | `0xe6fab3F0c7199b0d34d7FbE83394fc0e0D06e99d` |
| WETH (18) | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |
| USDC native (6) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

**Two-router pattern:** approve USDC to the **SyntheticsRouter** (`0x7452…`), NOT the ExchangeRouter.

## Markets (confirm full set via `getMarketsInfo()` at runtime)
| Market | Market token |
|---|---|
| BTC/USD | `0x47c031236e19d024b42f8AE6780E44A573170703` |
| ETH/USD [WETH-USDC] | `0x70d95587d40A2caf56bd97485aB3Eec10Bee6336` |
| SOL/USD | `0x09400D9DB990D5ed3f35D7be61DfAEB900Af03C9` |

## Enums (from Order.sol)
- OrderType: MarketSwap=0, LimitSwap=1, **MarketIncrease=2**, LimitIncrease=3, **MarketDecrease=4**,
  LimitDecrease=5, StopLossDecrease=6, Liquidation=7, StopIncrease=8.
- DecreasePositionSwapType: NoSwap=0, SwapPnlTokenToCollateralToken=1, SwapCollateralTokenToPnlToken=2.

## CreateOrderParams (current ABI)
```
addresses { receiver, cancellationReceiver, callbackContract, uiFeeReceiver, market,
            initialCollateralToken, swapPath[] }
numbers   { sizeDeltaUsd, initialCollateralDeltaAmount, triggerPrice, acceptablePrice,
            executionFee, callbackGasLimit, minOutputAmount, validFromTime }
orderType, decreasePositionSwapType, isLong, shouldUnwrapNativeToken, autoCancel,
referralCode (bytes32 zero), dataList (bytes32[])
```
Market order = ExchangeRouter multicall: `sendWnt(orderVault, executionFee)` +
`sendTokens(USDC, orderVault, collateral)` + `createOrder(params)`.

## Decimals (highest bug-risk — centralize + unit-test)
- `sizeDeltaUsd` and all USD values: **30 decimals** (1e30).
- Token amounts: native decimals (USDC = 6).
- `acceptablePrice = indexPrice × 10^(30 − indexTokenDecimals)`.
- Tickers API prices are already 30-dp scaled.

## Tickers API
`GET https://arbitrum-api.gmxinfra.io/prices/tickers` →
`[{ tokenAddress, tokenSymbol, minPrice, maxPrice, updatedAt, timestamp }]` (prices 30-dp).

## Reads
- `Reader.getAccountPositions(dataStore, account, start, end)` → Position.Props[]
- `Reader.getPositionInfo(dataStore, referralStorage, positionKey, marketPrices, sizeDeltaUsd,
   uiFeeReceiver, usePositionSizeAsSizeDeltaUsd)` → PositionInfo
  - PositionInfo: `position`, `fees` (borrowing/funding/ui), `basePnlUsd`, **`pnlAfterPriceImpactUsd`** (30dp).
- `positionKey = keccak256(abi.encode(account, market, collateralToken, isLong))`
- `marketPrices` = min/max index/long/short token prices (30-dp) from tickers.

## Async / footguns
- Orders are async: createOrder → keeper executes with oracle price (seconds). Poll Reader / order-removed event.
- Wallet MUST hold ETH for gas AND executionFee (keeper refunds excess). Overpay execFee slightly.
- Set `acceptablePrice` tolerant (oracle mid ± slippage, right direction) or the keeper rejects.
- Min position size / collateral enforced — demo size ~$15–25 notional.
- Pending-order collateral sits in OrderVault: in NAV, count it exactly once.
