import { arbitrum } from "viem/chains";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, type Config } from "./config.js";

export const chain = arbitrum;

export function makePublicClient(cfg: Config = loadConfig()): PublicClient {
  return createPublicClient({
    chain,
    transport: http(cfg.ARBITRUM_RPC),
  });
}

// The single hot account = GMX trader + Lagoon valuationManager + curator/safe.
export function makeAccount(cfg: Config = loadConfig()): Account | undefined {
  if (!cfg.HOT_PK) return undefined;
  return privateKeyToAccount(cfg.HOT_PK as `0x${string}`);
}

export function makeWalletClient(cfg: Config = loadConfig()): WalletClient | undefined {
  const account = makeAccount(cfg);
  if (!account) return undefined;
  return createWalletClient({
    account,
    chain,
    transport: http(cfg.ARBITRUM_RPC),
  });
}
