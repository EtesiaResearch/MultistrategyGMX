import "dotenv/config";
import { z } from "zod";

// 0x-prefixed 32-byte hex private key.
const pkSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex private key");

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x EVM address");

// Coerced boolean from "true"/"false"/"1"/"0".
const boolSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const ConfigSchema = z.object({
  // Network
  ARBITRUM_RPC: z.string().url().default("https://arb1.arbitrum.io/rpc"),
  GMX_ORACLE_URL: z.string().url().default("https://arbitrum-api.gmxinfra.io"),
  CHAIN_ID: z.coerce.number().int().positive().default(42161),

  // Hot wallet — optional in dev (read-only / simulate), required to broadcast.
  HOT_PK: pkSchema.optional(),
  // The single hot EOA address (E) = GMX trader = valuationManager = curator/safe.
  // The startup check asserts privateKeyToAccount(HOT_PK).address === EXPECTED_EOA.
  EXPECTED_EOA: addressSchema.default("0xee94E1A5534A70231DaEE670b51fEC50AC032b6A"),

  // Lagoon vault on Arbitrum One (deployed; both roles = E).
  VAULT_ADDRESS: addressSchema.default("0x7f6c5ed71ca969168247958057fcfe06c68ad5a2"),
  SILO_ADDRESS: addressSchema.optional(),

  // GMX V2 contracts (Arbitrum One — verified 2026-06-14, see .claude/gmx.md).
  GMX_EXCHANGE_ROUTER: addressSchema.default("0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41"),
  GMX_ROUTER: addressSchema.default("0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6"),
  GMX_ORDER_VAULT: addressSchema.default("0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5"),
  GMX_DATASTORE: addressSchema.default("0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8"),
  GMX_READER: addressSchema.default("0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789"),
  GMX_REFERRAL_STORAGE: addressSchema.default("0xe6fab3F0c7199b0d34d7FbE83394fc0e0D06e99d"),
  USDC_ADDRESS: addressSchema.default("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
  WETH_ADDRESS: addressSchema.default("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),

  // Trading params
  TARGET_LEVERAGE: z.coerce.number().positive().default(2),
  MIN_ORDER_USD: z.coerce.number().positive().default(15),
  MAX_TOTAL_NOTIONAL_USD: z.coerce.number().positive().default(200),
  ACCEPTABLE_PRICE_SLIPPAGE_BPS: z.coerce.number().int().nonnegative().default(150),

  // Signal source
  SIGNAL_SOURCE: z.enum(["mock", "hlnative"]).default("mock"),
  HLNATIVE_BASE_URL: z.string().url().default("http://localhost:4000"),
  MIRROR_SCALE: z.coerce.number().positive().default(1),

  // NAV guards (ported from etesia-curator)
  STRICT_FIRST_NAV_ZERO: boolSchema.default("true"),
  NAV_DIVERGENCE_MAX_BPS: z.coerce.number().int().positive().default(1000),

  // Operational
  DRY_RUN: boolSchema.default("true"),
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  TRADE_CRON: z.string().default("*/2 * * * *"),
  NAV_CRON: z.string().default("*/2 * * * *"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().positive().default(8080),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  // Treat empty env values ("FOO=") as unset so defaults/optionals apply —
  // .env.example ships keys blank by design.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== "") env[k] = v;
  }
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

// True when we are allowed to broadcast transactions.
export function canBroadcast(cfg: Config): boolean {
  return !cfg.DRY_RUN && cfg.HOT_PK !== undefined;
}
