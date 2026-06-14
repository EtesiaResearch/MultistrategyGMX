import type { Logger } from "pino";
import { getAddress, type Address, type PublicClient } from "viem";
import { usdcAbi } from "./abi/usdc.js";
import { vaultAbi } from "./abi/vault.js";

// Fail-fast guards run once at boot. NAV push (updateNewTotalAssets, onlyValuationManager)
// and settle (settleDeposit/Redeem, onlySafe) revert if the on-chain roles don't resolve to
// our hot EOA (E), so we verify up front and abort with a clear message instead of looping
// on reverts. Also warns if E holds personal USDC that would be miscounted as vault NAV.
export interface StartupCheckDeps {
  publicClient: PublicClient;
  logger: Logger;
  account?: Address | undefined; // privateKeyToAccount(HOT_PK).address, if set
  expectedEoa: Address; // E
  vault?: Address | undefined;
  usdc: Address;
}

export interface StartupInfo {
  silo: Address | null;
  assetDecimals: number;
}

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

export async function runStartupCheck(deps: StartupCheckDeps): Promise<StartupInfo> {
  const { publicClient, logger, account, usdc } = deps;
  const E = getAddress(deps.expectedEoa);

  // 1) HOT_PK actually controls E.
  if (account) {
    if (!sameAddress(account, E)) {
      throw new Error(
        `HOT_PK controls ${getAddress(account)} but EXPECTED_EOA (E) is ${E}. Wrong key — aborting.`,
      );
    }
    logger.info({ E }, "startup: HOT_PK controls E ✓");
  } else {
    logger.warn("startup: no HOT_PK set — read-only / dry-run mode");
  }

  const assetDecimals = await publicClient.readContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "decimals",
  });

  if (!deps.vault) {
    logger.warn("startup: no VAULT_ADDRESS — skipping vault role checks");
    return { silo: null, assetDecimals };
  }
  const vault = getAddress(deps.vault);

  // 2) Vault roles + asset must resolve to E / USDC, else push & settle revert.
  const [owner, safe, asset] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "safe" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
  ]);
  if (!sameAddress(owner, E)) {
    throw new Error(`vault.owner()=${getAddress(owner)} != E=${E} — admin/settle would fail. Aborting.`);
  }
  if (!sameAddress(safe, E)) {
    throw new Error(
      `vault.safe()=${getAddress(safe)} != E=${E} — settleDeposit/Redeem (onlySafe) would revert. Aborting.`,
    );
  }
  if (!sameAddress(asset, usdc)) {
    throw new Error(`vault.asset()=${getAddress(asset)} != native USDC ${getAddress(usdc)}. Aborting.`);
  }
  logger.info({ vault, owner: E, safe: E, asset: getAddress(asset) }, "startup: vault owner+safe=E, asset=USDC ✓");

  // valuationManager — best-effort (older deploys don't expose a getter). If we CAN
  // read it and it differs, abort; otherwise rely on the push-time simulation guard.
  const valuationManager = await readValuationManager(publicClient, vault);
  if (valuationManager) {
    if (!sameAddress(valuationManager, E)) {
      throw new Error(
        `vault.valuationManager()=${getAddress(valuationManager)} != E=${E} — updateNewTotalAssets would revert. Aborting.`,
      );
    }
    logger.info({ valuationManager: E }, "startup: valuationManager=E ✓");
  } else {
    logger.warn(
      "startup: valuationManager getter not exposed by this vault version — enforced at first NAV push (simulation reverts if wrong)",
    );
  }

  // Silo (informational; NAV never reads it — deposits are excluded until settle).
  let silo: Address | null = null;
  try {
    silo = (await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "pendingSilo" })) as Address;
  } catch {
    /* older deploy — getter absent */
  }

  // 3) NAV cleanliness: idle NAV = balanceOf(E). If E holds USDC while the vault is
  // still empty, that personal money will be counted as vault NAV on the first push.
  const [eUsdc, totalSupply] = await Promise.all([
    publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [E] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
  ]);
  logger.info(
    { silo: silo ?? "(getter n/a)", assetDecimals, shareDecimals: 18, eUsdc: (Number(eUsdc) / 10 ** assetDecimals).toString() },
    "startup: vault asset/silo/decimals",
  );
  if (eUsdc > 0n && totalSupply === 0n) {
    logger.warn(
      { eUsdcUsd: Number(eUsdc) / 10 ** assetDecimals },
      "STARTUP WARNING: E holds USDC while the vault is empty (totalSupply=0). It will be counted as vault NAV — move personal USDC out to wallet D before pushing first NAV=0.",
    );
  }

  return { silo, assetDecimals };
}

async function readValuationManager(publicClient: PublicClient, vault: Address): Promise<Address | null> {
  try {
    const roles = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getRolesStorage" });
    return (roles as { valuationManager: Address }).valuationManager;
  } catch {
    /* fall through */
  }
  try {
    return (await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "valuationManager" })) as Address;
  } catch {
    return null;
  }
}
