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

/** Bottom sheet: decelerate in (also the settle after a short drag), accelerate out. */
export const SHEET_MOTION = {
  enter: { duration: "medium2", easing: "emphasizedDecelerate" },
  exit: { duration: "short4", easing: "emphasizedAccelerate" },
} as const satisfies Record<string, { duration: DurationToken; easing: EasingToken }>;
