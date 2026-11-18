export const SSE_RETRY_MIN_MS = 5_000;
export const SSE_RETRY_MAX_MS = 300_000;
export const SSE_RETRY_GATEWAY_MAX_MS = 30_000;
export const RECONCILE_MS = 600_000;

export function jittered(ms: number, random: () => number = Math.random): number {
  return Math.round(ms * (0.8 + 0.4 * random()));
}

/** Wait before the next realtime connect, after `failures` attempts in a row never opened a stream. */
export function sseRetryDelay(failures: number, max = SSE_RETRY_MAX_MS, random: () => number = Math.random): number {
  const base = SSE_RETRY_MIN_MS * 2 ** Math.min(16, Math.max(0, failures - 1));
  return Math.min(max, jittered(base, random));
}
