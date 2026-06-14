import type { Logger } from "pino";
import type { SignalSource, Target } from "./types.js";

// hlnative exposes the live book at GET /api/positions (open, no auth):
//   { positions: [{ instrumentKey: "BTC_USDC_USDC", baseUnits: <signed>, notionalUsd: <abs>, ... }] }
// We mirror it: map BASE_USDC_USDC -> BASE (GMX index symbol), drop RWA (XYZ_*),
// and rescale HL's AUM-sized notionals to this GMX vault via MIRROR_SCALE.
interface HlPosition {
  instrumentKey: string;
  baseUnits: number;
  notionalUsd: number;
}

function isRwa(instrumentKey: string): boolean {
  return instrumentKey.startsWith("XYZ_");
}

function baseSymbol(instrumentKey: string): string | null {
  if (isRwa(instrumentKey)) return null;
  const base = instrumentKey.split("_")[0];
  return base && base.length > 0 ? base : null;
}

export class HlnativeSignalSource implements SignalSource {
  readonly name = "hlnative";
  constructor(
    private readonly baseUrl: string,
    private readonly mirrorScale: number,
    private readonly logger?: Logger,
  ) {}

  async getTargets(): Promise<Target[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/positions`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`hlnative ${url} -> ${res.status}`);
    const body = (await res.json()) as { positions?: HlPosition[] };
    const positions = body.positions ?? [];

    const targets: Target[] = [];
    const skipped: string[] = [];
    for (const p of positions) {
      const symbol = baseSymbol(p.instrumentKey);
      if (!symbol) {
        skipped.push(p.instrumentKey);
        continue;
      }
      const sign = Math.sign(p.baseUnits) || 0;
      const signedNotionalUsd = sign * Math.abs(p.notionalUsd) * this.mirrorScale;
      if (signedNotionalUsd !== 0) targets.push({ symbol, signedNotionalUsd });
    }
    this.logger?.info(
      { count: targets.length, skippedRwa: skipped, scale: this.mirrorScale },
      "hlnative targets",
    );
    return targets;
  }
}
