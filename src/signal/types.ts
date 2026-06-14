// A desired portfolio target, normalized across signal sources.
export interface Target {
  symbol: string; // GMX index symbol: "BTC", "ETH", "SOL", ...
  signedNotionalUsd: number; // + = long, - = short, 0 = flat
}

export interface SignalSource {
  name: string;
  getTargets(): Promise<Target[]>;
}
