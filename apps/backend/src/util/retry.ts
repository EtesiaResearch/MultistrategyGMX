// The GmxSdk builds its viem clients with transport retries DISABLED, and GMX's docs
// tell integrators to wrap their own retry/backoff around read paths. A flaky RPC
// response (or partial markets/tokens data) otherwise surfaces as an empty result.
// Retries on thrown errors, and optionally on a result that `retryOn` deems incomplete.
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; retryOn?: (value: T) => boolean } = {},
): Promise<T> {
  const tries = opts.tries ?? 4;
  const baseMs = opts.baseMs ?? 150;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const value = await fn();
      if (opts.retryOn && opts.retryOn(value) && i < tries - 1) {
        await sleep(baseMs * 2 ** i);
        continue;
      }
      return value;
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}
