import type { SignalSource, Target } from "./types.js";

// Returns no targets → reconcile flattens every open position and keeps it flat.
// Set SIGNAL_SOURCE=flat to wind the bot down without stopping it.
export class FlatSignalSource implements SignalSource {
  readonly name = "flat";
  getTargets(): Promise<Target[]> {
    return Promise.resolve([]);
  }
}
