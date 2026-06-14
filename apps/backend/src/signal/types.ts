// A desired portfolio target, normalized across signal sources.
export interface Target {
  symbol: string; // GMX index symbol: "BTC", "ETH", "SOL", ...
  signedNotionalUsd: number; // + = long, - = short, 0 = flat
}

// Context the trade-cycle passes into getTargets. `supportedSymbols` = the symbols GMX
// can actually trade this cycle; the dynamic mirror scales over ONLY these so an
// untradable leg (e.g. PAXG) can't shrink every other leg below the order floor.
export interface GetTargetsContext {
  supportedSymbols?: Set<string>;
}

export interface SignalSource {
  name: string;
  getTargets(ctx?: GetTargetsContext): Promise<Target[]>;
}
