import { formatUnits, parseUnits } from "viem";

/**
 * Parse a user-typed amount into a bigint at `decimals`, or null when the
 * input is empty/invalid/too precise. Everything onchain stays bigint —
 * `Number()` never touches these values.
 */
export function parseAmountInput(raw: string, decimals: number): bigint | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`).test(trimmed)) return null;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

/** True when the input is non-empty but not a valid amount at `decimals`. */
export function isMalformedAmount(raw: string, decimals: number): boolean {
  return raw.trim() !== "" && parseAmountInput(raw, decimals) === null;
}

/**
 * Display a bigint token amount with at most `maxDp` decimals (trimmed,
 * locale-grouped). Render boundary — display only.
 */
export function formatTokenAmount(value: bigint, decimals: number, maxDp = 4): string {
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDp });
}
