import type { Logger } from "pino";
import type { Config } from "../config.js";
import { HlnativeSignalSource } from "./hlnative.js";
import { MockSignalSource } from "./mock.js";
import type { SignalSource } from "./types.js";

export type { SignalSource, Target } from "./types.js";

export function makeSignalSource(cfg: Config, logger?: Logger): SignalSource {
  if (cfg.SIGNAL_SOURCE === "hlnative") {
    return new HlnativeSignalSource(cfg.HLNATIVE_BASE_URL, cfg.MIRROR_SCALE, logger);
  }
  return new MockSignalSource();
}
