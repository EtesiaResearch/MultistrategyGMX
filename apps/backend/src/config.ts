import "dotenv/config";
import { z } from "zod";
import { CHAIN_ID, EXPECTED_EOA, USDC_ADDRESS, VAULT_ADDRESS, WETH_ADDRESS } from "@etesia/shared";

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
  CHAIN_ID: z.coerce.number().int().positive().default(CHAIN_ID),

  // Hot wallet — optional in dev (read-only / simulate), required to broadcast.
  HOT_PK: pkSchema.optional(),
  // The single hot EOA address (E) = GMX trader = valuationManager = curator/safe.
  // The startup check asserts privateKeyToAccount(HOT_PK).address === EXPECTED_EOA.
  EXPECTED_EOA: addressSchema.default(EXPECTED_EOA),

  // Lagoon vault on Arbitrum One (deployed; both roles = E).
  VAULT_ADDRESS: addressSchema.default(VAULT_ADDRESS),
  SILO_ADDRESS: addressSchema.optional(),

  // GMX V2 contracts (Arbitrum One — verified 2026-06-14, see .claude/gmx.md).
  GMX_EXCHANGE_ROUTER: addressSchema.default("0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41"),
  GMX_ROUTER: addressSchema.default("0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6"),
  GMX_ORDER_VAULT: addressSchema.default("0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5"),
  GMX_DATASTORE: addressSchema.default("0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8"),
  GMX_READER: addressSchema.default("0x470fbC46bcC0f16532691Df360A07d8Bf5ee0789"),
  GMX_REFERRAL_STORAGE: addressSchema.default("0xe6fab3F0c7199b0d34d7FbE83394fc0e0D06e99d"),
  USDC_ADDRESS: addressSchema.default(USDC_ADDRESS),
  WETH_ADDRESS: addressSchema.default(WETH_ADDRESS),

  // Trading params
  TARGET_LEVERAGE: z.coerce.number().positive().default(2),
  // Min order notional. 0 (default) = DERIVE from GMX's on-chain MIN_COLLATERAL_USD
  // × TARGET_LEVERAGE × MIN_ORDER_SAFETY_MARGIN. The floor exists ONLY to avoid GMX
  // reverting a sub-minimum order (wasted gas) — NOT to thin the book. Set > 0 to force
  // an explicit floor (not recommended — strands legs).
  MIN_ORDER_USD: z.coerce.number().nonnegative().default(0),
  MIN_ORDER_SAFETY_MARGIN: z.coerce.number().positive().default(1.5),
  MIN_ORDER_FALLBACK_USD: z.coerce.number().positive().default(5),
  MAX_TOTAL_NOTIONAL_USD: z.coerce.number().positive().default(200),
  ACCEPTABLE_PRICE_SLIPPAGE_BPS: z.coerce.number().int().nonnegative().default(150),

  // Signal source. "flat" = no targets → bot closes everything and stays flat.
  SIGNAL_SOURCE: z.enum(["mock", "hlnative", "flat"]).default("mock"),
  HLNATIVE_BASE_URL: z.string().url().default("http://localhost:4000"),
  // Static fallback scale (used when MIRROR_DYNAMIC=false).
  MIRROR_SCALE: z.coerce.number().positive().default(1),
  // Dynamic mirror: normalize the hlnative book so Σ|notional| = NAV × MIRROR_GROSS_LEVERAGE
  // (a proportional replica that auto-resizes as NAV grows). On by default.
  MIRROR_DYNAMIC: boolSchema.default("true"),
  MIRROR_GROSS_LEVERAGE: z.coerce.number().positive().default(1),
  // Mirror only the N largest positions (by |notional|). 0 = all. With small capital,
  // spreading across the whole book puts every leg below MIN_ORDER_USD — cap to the top few.
  MIRROR_TOP_N: z.coerce.number().int().nonnegative().default(0),

  // NAV guards (ported from etesia-curator)
  STRICT_FIRST_NAV_ZERO: boolSchema.default("true"),
  NAV_DIVERGENCE_MAX_BPS: z.coerce.number().int().positive().default(1000),
  // Gas watchdog: warn loudly + flag /status when E's ETH drops below this (ether).
  GAS_MIN_ETH: z.coerce.number().positive().default(0.002),

  // Operational — 15min default cadence (a 2min NAV push spams updateNewTotalAssets
  // and burns the EOA's ETH; prod should be slower still, ~12h like etesia-curator).
  DRY_RUN: boolSchema.default("true"),
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  TRADE_CRON: z.string().default("*/15 * * * *"),
  NAV_CRON: z.string().default("*/15 * * * *"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().positive().default(8080),

  // NAV/share-price history for the web chart — one ndjson line per NAV cycle,
  // also mirrored in memory and served at GET /history. On Railway, point this at
  // a mounted volume to survive redeploys (the container FS is otherwise ephemeral).
  HISTORY_PATH: z.string().default("./data/history.ndjson"),
  HISTORY_MAX: z.coerce.number().int().positive().default(5000),
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
