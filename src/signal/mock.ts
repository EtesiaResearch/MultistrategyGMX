import type { SignalSource, Target } from "./types.js";

// Hardcoded targets for Phases 1-3 and demo flips. Swap the returned set (or wire
// an env override) to drive the executor without the live hlnative feed.
export class MockSignalSource implements SignalSource {
  readonly name = "mock";
  constructor(private readonly targets: Target[] = DEFAULT_TARGETS) {}
  getTargets(): Promise<Target[]> {
    return Promise.resolve(this.targets);
  }
}

// A tiny, GMX-valid demo portfolio (~$15–20 notional per leg).
export const DEFAULT_TARGETS: Target[] = [{ symbol: "ETH", signedNotionalUsd: 15 }];

// Convenience presets for the demo script (open -> flip -> flat).
export const DEMO_LONG: Target[] = [{ symbol: "ETH", signedNotionalUsd: 15 }];
export const DEMO_FLIP: Target[] = [{ symbol: "ETH", signedNotionalUsd: -15 }];
export const DEMO_FLAT: Target[] = [];
