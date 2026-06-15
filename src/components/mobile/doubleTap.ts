export interface TapPoint { t: number; x: number; y: number; }

/** True when `next` follows `prev` closely enough in time and space to be a double-tap. */
export function isDoubleTap(prev: TapPoint, next: TapPoint, opts: { ms: number; px: number }): boolean {
  return next.t - prev.t <= opts.ms && Math.hypot(next.x - prev.x, next.y - prev.y) <= opts.px;
}
