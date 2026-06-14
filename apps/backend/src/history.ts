import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { HistorySample } from "@etesia/shared";

// NAV/share-price history for the web chart. One sample is recorded per NAV cycle:
// kept in memory (capped ring) and appended as ndjson so it survives process
// restarts. On Railway, point HISTORY_PATH at a mounted volume to also survive
// redeploys (the container FS is otherwise ephemeral). Disk is best-effort — a
// write failure drops to in-memory only rather than crashing the NAV loop.
export interface HistoryStore {
  record: (sample: HistorySample) => void;
  list: (fromMs?: number) => HistorySample[];
}

export async function makeHistoryStore(opts: {
  path: string;
  max: number;
  logger: Logger;
}): Promise<HistoryStore> {
  const { path, max, logger } = opts;
  const buf: HistorySample[] = [];
  let writable = true;

  await mkdir(dirname(path), { recursive: true }).catch(() => {
    writable = false;
  });

  // Load existing history (best-effort) — tail to the cap.
  try {
    const raw = await readFile(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        buf.push(JSON.parse(trimmed) as HistorySample);
      } catch {
        /* skip a malformed line rather than failing the whole load */
      }
    }
    if (buf.length > max) buf.splice(0, buf.length - max);
    logger.info({ path, samples: buf.length }, "history: loaded from disk");
  } catch {
    logger.info({ path }, "history: no existing file — starting fresh");
  }

  function record(sample: HistorySample): void {
    buf.push(sample);
    if (buf.length > max) buf.shift();
    if (!writable) return;
    void appendFile(path, `${JSON.stringify(sample)}\n`, "utf8").catch((err: unknown) => {
      writable = false;
      logger.warn({ err, path }, "history: append failed — keeping in-memory only");
    });
  }

  function list(fromMs?: number): HistorySample[] {
    if (fromMs === undefined) return [...buf];
    return buf.filter((s) => s.t >= fromMs);
  }

  return { record, list };
}
