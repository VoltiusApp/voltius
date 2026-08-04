import type { PingTarget } from "./pingTargets";

export const TICK_MS = 1_000;
export const STARTUP_SPREAD_MS = 5_000;

/// FNV-1a over the target key: stable across ticks and app restarts, so a
/// large host list does not fire on a single tick.
export function jitterFor(key: string, spanMs: number): number {
  if (spanMs <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % spanMs;
}

export function intervalFor(target: PingTarget, sessionMs: number, idleMs: number): number {
  return target.sessionId ? sessionMs : idleMs;
}

export function selectDue(
  targets: PingTarget[],
  dueAt: Record<string, number>,
  now: number,
  sessionMs: number,
  idleMs: number,
): { due: PingTarget[]; dueAt: Record<string, number> } {
  const next: Record<string, number> = {};
  const due: PingTarget[] = [];

  for (const target of targets) {
    const scheduled = dueAt[target.key];

    if (scheduled === undefined) {
      next[target.key] = now + jitterFor(target.key, STARTUP_SPREAD_MS);
      continue;
    }

    if (now >= scheduled) {
      due.push(target);
      const interval = intervalFor(target, sessionMs, idleMs);
      next[target.key] = now + interval + jitterFor(target.key, Math.floor(interval / 4));
    } else {
      next[target.key] = scheduled;
    }
  }

  return { due, dueAt: next };
}
