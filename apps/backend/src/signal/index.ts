import type { Logger } from "pino";
import type { Config } from "../config.js";
import { FlatSignalSource } from "./flat.js";
import { HlnativeSignalSource } from "./hlnative.js";
import { MockSignalSource } from "./mock.js";
import type { SignalSource } from "./types.js";

export type { SignalSource, Target } from "./types.js";

// navProvider supplies the current vault NAV (USD) for the dynamic hlnative mirror.
export function makeSignalSource(
  cfg: Config,
  logger?: Logger,
  navProvider?: () => Promise<number>,
): SignalSource {
  if (cfg.SIGNAL_SOURCE === "flat") {
    return new FlatSignalSource();
  }
  if (cfg.SIGNAL_SOURCE === "hlnative") {
    return new HlnativeSignalSource(
      cfg.HLNATIVE_BASE_URL,
      {
        dynamic: cfg.MIRROR_DYNAMIC,
        mirrorScale: cfg.MIRROR_SCALE,
        grossLeverage: cfg.MIRROR_GROSS_LEVERAGE,
        ...(navProvider ? { navProvider } : {}),
      },
      logger,
    );
  }
  return new MockSignalSource();
}
