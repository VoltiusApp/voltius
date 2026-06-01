export const DEFAULT_SCROLLBACK_LINES = 50_000;
export const MIN_SCROLLBACK_LINES = 1_000;
export const MAX_SCROLLBACK_LINES = 250_000;

export function clampScrollbackLines(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCROLLBACK_LINES;
  return Math.max(MIN_SCROLLBACK_LINES, Math.min(MAX_SCROLLBACK_LINES, Math.round(value)));
}
