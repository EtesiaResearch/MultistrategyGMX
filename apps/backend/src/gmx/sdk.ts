import { GmxSdk } from "@gmx-io/sdk";
import { loadConfig, type Config } from "../config.js";
import { makeWalletClient } from "../clients.js";

// subsquidUrl is type-required but only consumed by getTradeHistory (unused here).
const SUBSQUID_URL = "https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql";

// Build a GmxSdk. We let the SDK construct its own (batch-configured) public client
// from rpcUrl; we pass a walletClient (with the hot account) only when a key is set,
// which is what enables broadcasting orders.
type GmxSdkConfig = ConstructorParameters<typeof GmxSdk>[0];

export function makeGmxSdk(cfg: Config = loadConfig()): GmxSdk {
  const walletClient = makeWalletClient(cfg);
  const config: GmxSdkConfig = {
    chainId: cfg.CHAIN_ID as 42161,
    rpcUrl: cfg.ARBITRUM_RPC,
    oracleUrl: cfg.GMX_ORACLE_URL,
    subsquidUrl: SUBSQUID_URL,
  };
  // viem is installed twice (peer-hashed by typescript version) so our WalletClient
  // is nominally distinct from the SDK's — identical at runtime (viem 2.52.2). Cast
  // across the one boundary where we hand a client to the SDK.
  if (walletClient) {
    config.walletClient = walletClient as unknown as NonNullable<GmxSdkConfig["walletClient"]>;
  }
  const sdk = new GmxSdk(config);
  // Set the account for reads (positions/orders) even with no signer — read-only NAV
  // works against E's on-chain state. With a key, the signer address is the same E.
  sdk.setAccount(walletClient?.account?.address ?? (cfg.EXPECTED_EOA as `0x${string}`));
  return sdk;
}
