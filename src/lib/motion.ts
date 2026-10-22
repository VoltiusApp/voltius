/**
 * Motion tokens: the one set of Material 3 easings and durations every mobile
 * animation uses. CSS reads them as custom properties (`--vt-ease-*`, `--vt-dur-*`,
 * declared in globals.css, which zeroes the durations under prefers-reduced-motion);
 * JS-driven animations (WAAPI) go through `animate()` / `motionMs()` here, which
 * collapse to 0 ms the same way. motion.test.ts keeps both copies in sync.
 */

/** M3 easing tokens (emphasized is M3's single-bezier CSS approximation). */
export const EASING = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  standardDecelerate: "cubic-bezier(0, 0, 0, 1)",
  standardAccelerate: "cubic-bezier(0.3, 0, 1, 1)",
  emphasized: "cubic-bezier(0.2, 0, 0, 1)",
  emphasizedDecelerate: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  emphasizedAccelerate: "cubic-bezier(0.3, 0, 0.8, 0.15)",
  linear: "linear",
} as const;

/** M3 duration tokens, ms. */
export const DURATION = {
  short1: 50,
  short2: 100,
  short3: 150,
  short4: 200,
  medium1: 250,
  medium2: 300,
  medium3: 350,
  medium4: 400,
  long1: 450,
  long2: 500,
  long3: 550,
  long4: 600,
} as const;

export type EasingToken = keyof typeof EASING;
export type DurationToken = keyof typeof DURATION;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** CSS custom property holding an easing token, e.g. `var(--vt-ease-emphasized-decelerate)`. */
export const easeVar = (e: EasingToken) => `var(--vt-ease-${kebab(e)})`;
/** CSS custom property holding a duration token (0ms under reduced motion), e.g. `var(--vt-dur-medium2)`. */
export const durVar = (d: DurationToken) => `var(--vt-dur-${d})`;

/** A CSS `transition` value for `props`, built from the tokens' custom properties. */
export function transition(props: string | readonly string[], d: DurationToken, e: EasingToken): string {
  return (typeof props === "string" ? [props] : props).map((p) => `${p} ${durVar(d)} ${easeVar(e)}`).join(", ");
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Duration in ms for JS timing (WAAPI, timers): 0 under reduced motion. */
export function motionMs(d: DurationToken | number): number {
  if (prefersReducedMotion()) return 0;
  return typeof d === "number" ? d : DURATION[d];
}

/** WAAPI timing for a token pair, reduced-motion aware. */
export function timing(d: DurationToken | number, e: EasingToken, extra?: KeyframeAnimationOptions): KeyframeAnimationOptions {
  return { ...extra, duration: motionMs(d), easing: EASING[e] };
}

/** `el.animate` with token timing (instant under reduced motion). */
export function animate(
  el: Element,
  keyframes: Keyframe[],
  d: DurationToken | number,
  e: EasingToken,
  extra?: KeyframeAnimationOptions,
): Animation {
  return el.animate(keyframes, timing(d, e, extra));
}

/** Android predictive back preview (M3), formerly predictiveBack.ts's BACK_PREVIEW_MOTION. */
export const BACK_PREVIEW = {
  /** Page scale at full progress (M3: 90 %). */
  pageMinScale: 0.9,
  /** M3 horizontal shift: up to width / 20 − 8 dp. */
  pageShiftDivisor: 20,
  pageShiftMarginPx: 8,
  /** Corner radius the page grows to (reached at 25 % progress). */
  pageCornerPx: 28,
  /** Sheet shrink at full progress (M3 bottom sheet: 48 dp narrower, 24 dp shorter). */
  sheetShrinkXPx: 48,
  sheetShrinkYPx: 24,
  /** Cancel: back to rest. */
  cancel: { duration: "medium1", easing: "standard" },
  /** Commit: the page fades out before it closes. */
  commit: { duration: "short2", easing: "emphasizedAccelerate" },
} as const satisfies Record<string, number | { duration: DurationToken; easing: EasingToken }>;

/** Bottom sheet: decelerate in, accelerate out; the drag gesture (components/mobile/sheets/sheetDrag.ts). */
export const SHEET_MOTION = {
  enter: { duration: "medium2", easing: "emphasizedDecelerate" },
  exit: { duration: "short4", easing: "emphasizedAccelerate" },
  /** Release past this fraction of the sheet height dismisses it. */
  dismissFraction: 0.4,
  /** A downward fling faster than this (px/ms) dismisses it at any offset; upward keeps it. */
  flingVelocity: 0.5,
  /** Release velocity = movement over this window before the finger lifted. */
  velocityWindowMs: 100,
  /** Movement before a touch becomes a sheet drag (B5 TOUCH_SLOP_PX). */
  slopPx: 8,
  /** Upward drags rubber-band toward this many px. */
  rubberBandPx: 48,
  /** Spring back to rest (critically damped), rad/ms: ~300 ms to settle. */
  settleOmega: 0.026,
  /** A dismiss that continues from the release velocity takes between these many ms. */
  flingMinMs: 90,
  flingMaxMs: 250,
} as const;

/**
 * Critically damped spring (no overshoot) from `from` to `to`, starting at `velocity`
 * (units/ms, same sign convention as the values): `x(t) = to + (d + (v + ω·d)·t)·e^(−ωt)`.
 * Returns `samples` positions evenly spread over `duration` ms (until within `epsilon`
 * of the target), the last one exactly `to`. Feed it to WAAPI with linear easing.
 */
export function springSamples(
  from: number,
  to: number,
  velocity: number,
  omega: number,
  epsilon = 0.5,
  samples = 30,
): { duration: number; values: number[] } {
  const d = from - to;
  const x = (t: number) => (d + (velocity + omega * d) * t) * Math.exp(-omega * t);
  // Settled = displacement within epsilon from here on; step forward until it holds for good.
  let t = 0;
  const step = 1 / omega / 4;
  while (t < 20 / omega && (Math.abs(x(t)) > epsilon || Math.abs(x(t + step)) > epsilon)) t += step;
  const duration = Math.round(t);
  if (duration <= 0 || d === 0 && velocity === 0) return { duration: 0, values: [to] };
  const values = Array.from({ length: samples + 1 }, (_, i) => (i === samples ? to : to + x((duration * i) / samples)));
  return { duration, values };
}

/** Android snackbar (M3, components/mobile/MobileSnackbar.tsx): timing and swipe-away gesture. */
export const SNACKBAR_MOTION = {
  enter: { duration: "medium2", easing: "emphasizedDecelerate" },
  exit: { duration: "short3", easing: "emphasizedAccelerate" },
  /** A swipe released short of dismissing goes back. */
  settle: { duration: "medium1", easing: "standard" },
  /** Rises this many px while fading in. */
  enterShiftPx: 16,
  /** On-screen time clamp (M3: 4–10 s; longer with an action so it can be reached). */
  minMs: 4000,
  actionMinMs: 6000,
  maxMs: 10000,
  /** Released past this fraction of its width, or flung faster than this (px/ms) the same way, it leaves. */
  swipeFraction: 0.35,
  flingVelocity: 0.5,
  /** Movement before a touch becomes a swipe (B5 TOUCH_SLOP_PX). */
  slopPx: 8,
  /** Margin to the screen edges and to the docked chrome under it. */
  gapPx: 8,
} as const;

/** Page push / pop (M3 shared axis X, see hooks/pageTransition.ts). */
export const PAGE_MOTION = {
  push: { duration: "medium2", easing: "emphasizedDecelerate" },
  /** The leaving page accelerates away; the revealed one settles in. */
  popFront: { duration: "medium1", easing: "emphasizedAccelerate" },
  popBack: { duration: "medium1", easing: "emphasizedDecelerate" },
  /** Where the incoming / leaving page sits off rest, and where the covered one shifts and dims to. */
  frontShift: "30%",
  backShift: "-10%",
  backOpacity: 0.6,
} as const;

/** Navigation bar + tab switches (M3 fade-through, see hooks/pageTransition.ts useFadeThrough). */
export const NAV_MOTION = {
  /** Fade-through: the outgoing destination fades out, then the incoming one fades in from a slight zoom. */
  fadeOut: { duration: 90, easing: "standardAccelerate" },
  fadeIn: { duration: 210, easing: "emphasizedDecelerate" },
  fadeInScale: 0.92,
  /** The bar slides away under a pushed page / the immersive terminal, and back. */
  barHide: { duration: "short4", easing: "emphasizedAccelerate" },
  barShow: { duration: "medium1", easing: "emphasizedDecelerate" },
} as const satisfies Record<string, number | { duration: DurationToken | number; easing: EasingToken }>;

/** Switching terminal sessions (M3 shared axis X between siblings, see MobileSessionLayer). */
export const SESSION_MOTION = {
  /** The leaving session fades out early while sliding a little the other way. */
  exit: { duration: "short3", easing: "emphasizedAccelerate" },
  /** The arriving one slides in from the side it lives on and fades in. */
  enter: { duration: "medium2", easing: "emphasizedDecelerate" },
  shiftPx: 30,
  /** A cancelled session swipe settles back. */
  snapBack: { duration: "short4", easing: "standard" },
} as const satisfies Record<string, number | { duration: DurationToken | number; easing: EasingToken }>;

/** Moving between levels of a folder or directory list (M3 shared axis X, see hooks/pageTransition.ts useSharedAxis). */
export const AXIS_MOTION = {
  out: { duration: 90, easing: "standardAccelerate" },
  in: { duration: 210, easing: "emphasizedDecelerate" },
  outShiftPx: 10,
  inShiftPx: 30,
} as const satisfies Record<string, number | { duration: DurationToken | number; easing: EasingToken }>;

/** Pull to refresh (M3 swipe-to-refresh, see components/mobile/usePullToRefresh.ts). */
export const PULL_MOTION = {
  /** Released at least this far down (px, after resistance), the list refreshes. */
  thresholdPx: 72,
  /** The indicator never travels further than this, however far the finger goes. */
  maxPx: 128,
  /** Finger travel → indicator travel near the top (the rest is an exponential approach to maxPx). */
  resistance: 0.6,
  /** Where the spinning indicator rests while the list reloads. */
  restPx: 64,
  /** The spinner stays up at least this long, so a fast reload still reads as one. */
  minSpinMs: 500,
  /** Released short: back up. Released past: to the rest position. Done: shrinks away. */
  cancel: { duration: "short4", easing: "standardAccelerate" },
  settle: { duration: "medium1", easing: "emphasizedDecelerate" },
  exit: { duration: "short4", easing: "emphasizedAccelerate" },
} as const;
