import type { Logger } from "pino";
import { normalizeTargets, topNTargets } from "./scale.js";
import type { GetTargetsContext, SignalSource, Target } from "./types.js";

// hlnative exposes the live book at GET /api/positions (open, no auth):
//   { positions: [{ instrumentKey: "BTC_USDC_USDC", baseUnits: <signed>, notionalUsd: <abs>, ... }] }
// We mirror it: map BASE_USDC_USDC -> BASE (GMX index symbol), drop RWA (XYZ_*),
// then scale (dynamic NAV-proportional, or static) to this vault's size.
interface HlPosition {
  instrumentKey: string;
  baseUnits: number;
  notionalUsd: number;
}

export interface HlnativeOpts {
  dynamic: boolean;
  mirrorScale: number;
  grossLeverage: number;
  topN: number; // mirror only the N largest positions (0 = all)
  navProvider?: () => Promise<number>; // current vault NAV in USD (for dynamic scaling)
}

// hlnative base symbol -> GMX index symbol. Identity for most. PAXG (Pax Gold, a
// gold-price token) maps to GMX's XAU/USD synthetic perp, whose index symbol is "GOLD"
// (verified ~$4234 == gold). GMX also lists SILVER (XAG/USD) if a silver ticker appears.
const HL_TO_GMX_SYMBOL: Record<string, string> = {
  PAXG: "GOLD",
};

function gmxSymbol(instrumentKey: string): string | null {
  // XYZ_* are hlnative's RWA (xyz builder dex) — out of scope (crypto + gold only).
  if (instrumentKey.startsWith("XYZ_")) return null;
  const base = instrumentKey.split("_")[0];
  if (!base || base.length === 0) return null;
  return HL_TO_GMX_SYMBOL[base] ?? base;
}

export class HlnativeSignalSource implements SignalSource {
  readonly name = "hlnative";
  constructor(
    private readonly baseUrl: string,
    private readonly opts: HlnativeOpts,
    private readonly logger?: Logger,
  ) {}

  async getTargets(ctx?: GetTargetsContext): Promise<Target[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/positions`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`hlnative ${url} -> ${res.status}`);
    const body = (await res.json()) as { positions?: HlPosition[] };

    // Raw signed notionals (unscaled), RWA dropped.
    const raw: Target[] = [];
    const skipped: string[] = [];
    for (const p of body.positions ?? []) {
      const symbol = gmxSymbol(p.instrumentKey);
      if (!symbol) {
        skipped.push(p.instrumentKey);
        continue;
      }
      const sign = Math.sign(p.baseUnits) || 0;
      if (sign !== 0) raw.push({ symbol, signedNotionalUsd: sign * Math.abs(p.notionalUsd) });
    }

    // Drop legs GMX can't trade BEFORE scaling — otherwise an untradable leg (e.g. PAXG,
    // the biggest in the book) inflates the gross denominator and shrinks every tradable
    // leg below the order floor. Scaling must be over the legs we'll actually place.
    const notSupported: string[] = [];
    const tradable = ctx?.supportedSymbols
      ? raw.filter((t) => {
          const ok = ctx.supportedSymbols!.has(t.symbol);
          if (!ok) notSupported.push(t.symbol);
          return ok;
        })
      : raw;

    // Cap to the N largest legs (before scaling) so a big book fits a small vault.
    const capped = topNTargets(tradable, this.opts.topN);

    const navUsd = this.opts.dynamic && this.opts.navProvider ? await this.opts.navProvider() : 0;
    const targets = normalizeTargets(capped, {
      dynamic: this.opts.dynamic,
      mirrorScale: this.opts.mirrorScale,
      grossLeverage: this.opts.grossLeverage,
      navUsd,
    }).filter((t) => t.signedNotionalUsd !== 0);

    this.logger?.info(
      {
        rawCount: raw.length,
        mapped: tradable.map((t) => t.symbol), // hlnative legs replicated on GMX (post-symbol-map)
        notOnGmx: notSupported, // mapped but GMX has no market (genuinely impossible)
        skippedRwa: skipped, // XYZ_* RWA, out of scope
        scaledCount: targets.length,
        mode: this.opts.dynamic
          ? `dynamic(nav=${navUsd.toFixed(2)}x${this.opts.grossLeverage})`
          : `static(x${this.opts.mirrorScale})`,
      },
      "hlnative targets — mapped vs dropped",
    );
    return targets;
  }
}
