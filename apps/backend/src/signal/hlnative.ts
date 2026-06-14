import type { Logger } from "pino";
import { normalizeTargets } from "./scale.js";
import type { SignalSource, Target } from "./types.js";

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
  navProvider?: () => Promise<number>; // current vault NAV in USD (for dynamic scaling)
}

function baseSymbol(instrumentKey: string): string | null {
  if (instrumentKey.startsWith("XYZ_")) return null; // RWA — not on GMX
  const base = instrumentKey.split("_")[0];
  return base && base.length > 0 ? base : null;
}

export class HlnativeSignalSource implements SignalSource {
  readonly name = "hlnative";
  constructor(
    private readonly baseUrl: string,
    private readonly opts: HlnativeOpts,
    private readonly logger?: Logger,
  ) {}

  async getTargets(): Promise<Target[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/positions`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`hlnative ${url} -> ${res.status}`);
    const body = (await res.json()) as { positions?: HlPosition[] };

    // Raw signed notionals (unscaled), RWA dropped.
    const raw: Target[] = [];
    const skipped: string[] = [];
    for (const p of body.positions ?? []) {
      const symbol = baseSymbol(p.instrumentKey);
      if (!symbol) {
        skipped.push(p.instrumentKey);
        continue;
      }
      const sign = Math.sign(p.baseUnits) || 0;
      if (sign !== 0) raw.push({ symbol, signedNotionalUsd: sign * Math.abs(p.notionalUsd) });
    }

    const navUsd = this.opts.dynamic && this.opts.navProvider ? await this.opts.navProvider() : 0;
    const targets = normalizeTargets(raw, {
      dynamic: this.opts.dynamic,
      mirrorScale: this.opts.mirrorScale,
      grossLeverage: this.opts.grossLeverage,
      navUsd,
    }).filter((t) => t.signedNotionalUsd !== 0);

    this.logger?.info(
      {
        rawCount: raw.length,
        scaledCount: targets.length,
        mode: this.opts.dynamic
          ? `dynamic(nav=${navUsd.toFixed(2)}x${this.opts.grossLeverage})`
          : `static(x${this.opts.mirrorScale})`,
        skippedRwa: skipped,
      },
      "hlnative targets",
    );
    return targets;
  }
}
