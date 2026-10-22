import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AXIS_MOTION, NAV_MOTION, PAGE_MOTION, animate, prefersReducedMotion, type DurationToken, type EasingToken } from "@/lib/motion";

/**
 * Page transitions of the mobile shell (M3 shared axis X): a pushed page slides in
 * from the right while fading in over the outgoing one, which shifts slightly left
 * and dims; a pop reverses it. Used by the nav stack (MobileShell), the full-screen
 * overlays (settings, import/export) and the settings sub-pages.
 *
 * `useLayerTransition` detects the push / pop from a value + depth and keeps the
 * previous value for the length of the animation, so the consumer can render the
 * outgoing layer next to the new one. A predictive-back commit hands its preview over
 * (predictiveBack.ts, `handoff`): the leaving layer still wears the gesture's
 * scale / translate / corners, and the pop continues from there instead of restarting.
 * Transform / opacity only. Reduced motion: no transition, layers swap at once.
 */

export type LayerDir = "push" | "pop";

/** The upper and lower layer of a transition. push: incoming / outgoing; pop: leaving / revealed. */
export interface LayerEls {
  front: HTMLElement | null | undefined;
  back: HTMLElement | null | undefined;
}

/** The gesture's leftovers on a layer a predictive back preview handed over (inline styles). */
export interface PreviewPose {
  scale: string;
  translate: string;
  clipPath: string;
}

const poseOf = (el: HTMLElement): PreviewPose | null =>
  el.style.scale || el.style.translate ? { scale: el.style.scale || "1", translate: el.style.translate || "0px 0px", clipPath: el.style.clipPath } : null;

const rest: Keyframe = { translate: "0px 0px", opacity: 1 };
const shifted = (shift: string, opacity: number): Keyframe => ({ translate: `${shift} 0px`, opacity });

/** Pure keyframes of a transition. `pose`: where a predictive back left the leaving layer. */
export function layerFrames(dir: LayerDir, pose: PreviewPose | null = null): { front: Keyframe[]; back: Keyframe[] | null } {
  const m = PAGE_MOTION;
  const hidden = shifted(m.frontShift, 0);
  const dimmed = shifted(m.backShift, m.backOpacity);
  if (dir === "push") return { front: [hidden, rest], back: [rest, dimmed] };
  if (!pose) return { front: [rest, hidden], back: [dimmed, rest] };
  // From the gesture: keep its scale and corners, slide on from its offset. The layer
  // under it was already revealed at rest by the peek, so it doesn't move.
  const keep = pose.clipPath ? { scale: pose.scale, clipPath: pose.clipPath } : { scale: pose.scale };
  return {
    front: [{ ...keep, translate: pose.translate, opacity: 1 }, { ...keep, ...hidden }],
    back: null,
  };
}

/** Runs one transition on two layers; resolves when both are done (or cancelled). */
export function runLayerTransition(dir: LayerDir, { front, back }: LayerEls): { done: Promise<void>; cancel: () => void } {
  const timing = dir === "push" ? { front: PAGE_MOTION.push, back: PAGE_MOTION.push } : { front: PAGE_MOTION.popFront, back: PAGE_MOTION.popBack };
  const pose = dir === "pop" && front ? poseOf(front) : null;
  const frames = layerFrames(dir, pose);
  if (pose && front) {
    // The animation owns the pose now; the layer unmounts when it ends.
    front.style.scale = front.style.translate = front.style.clipPath = front.style.transition = "";
  }
  const anims: Animation[] = [];
  if (front) anims.push(animate(front, frames.front, timing.front.duration, timing.front.easing, { fill: "forwards" }));
  if (back && frames.back) anims.push(animate(back, frames.back, timing.back.duration, timing.back.easing));
  return {
    done: Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined),
    cancel: () => anims.forEach((a) => a.cancel()),
  };
}

/** Transitions run unless reduced motion is on or there is no WAAPI (jsdom): then layers swap at once. */
const animated = () => typeof Element !== "undefined" && typeof Element.prototype.animate === "function" && !prefersReducedMotion();

/** Push / pop between two values of a layer, from their depths (anything else: no transition). */
export function layerDir(prevDepth: number, depth: number): LayerDir | null {
  if (depth === prevDepth + 1) return "push";
  if (depth === prevDepth - 1) return "pop";
  return null;
}

export interface LayerTransition<T> {
  dir: LayerDir;
  /** The value before the change: the outgoing layer (push) or the leaving one (pop). */
  from: T;
}

/**
 * Tracks `value` and, when its depth goes one up or down, reports the transition and
 * runs it on the layers `els` names once both are rendered. Returns null when idle.
 */
export function useLayerTransition<T>(
  value: T,
  depth: number,
  els: (t: LayerTransition<T>) => LayerEls,
): LayerTransition<T> | null {
  const [seen, setSeen] = useState({ value, depth, tr: null as LayerTransition<T> | null });
  let tr = seen.tr;
  if (!Object.is(seen.value, value)) {
    // Derived during render, so the outgoing layer never misses a frame.
    const dir = layerDir(seen.depth, depth);
    tr = dir && animated() ? { dir, from: seen.value } : null;
    setSeen({ value, depth, tr });
  }
  const elsRef = useRef(els);
  elsRef.current = els;
  useLayoutEffect(() => {
    if (!tr) return;
    const run = runLayerTransition(tr.dir, elsRef.current(tr));
    let live = true;
    void run.done.then(() => {
      if (live) setSeen((s) => (s.tr === tr ? { ...s, tr: null } : s));
    });
    return () => {
      live = false;
      run.cancel();
    };
  }, [tr]);
  return tr;
}

export type LayerRole = "top" | "under" | "leave";

export interface StackLayer<T> {
  item: T;
  /** Position in the stack: a stable React key, so a layer keeps its DOM node when its role changes. */
  index: number;
  role: LayerRole;
}

/**
 * The layers to render for `stack`: the top one, the one under it while it is pushed
 * over or peeked by a predictive back, and the popped one while it leaves. In stack
 * order, so later layers paint above earlier ones.
 */
export function stackLayers<T>(
  stack: readonly T[],
  tr: LayerTransition<readonly T[]> | null,
  peek: boolean,
): StackLayer<T>[] {
  const n = stack.length;
  const out: StackLayer<T>[] = [];
  if (n >= 2 && (peek || tr?.dir === "push")) out.push({ item: stack[n - 2], index: n - 2, role: "under" });
  if (n >= 1) out.push({ item: stack[n - 1], index: n - 1, role: "top" });
  if (tr?.dir === "pop" && tr.from.length === n + 1) out.push({ item: tr.from[n], index: n, role: "leave" });
  return out;
}

/** True while what lies under the whole stack (the tab screen) must be rendered. */
export const stackRootVisible = (n: number, tr: LayerTransition<readonly unknown[]> | null, peek: boolean) =>
  n === 0 || (n === 1 && (peek || tr?.dir === "push"));

/** Front / back layers of a transition, from a role lookup; `base` is what lies under the bottom layer. */
export function pickLayers(
  dir: LayerDir,
  layer: (role: LayerRole) => HTMLElement | null | undefined,
  base: () => HTMLElement | null | undefined,
): LayerEls {
  return dir === "push"
    ? { front: layer("top"), back: layer("under") ?? base() }
    : { front: layer("leave"), back: layer("top") ?? base() };
}

const shellEl = () => document.querySelector<HTMLElement>("[data-mobile-shell]");

/**
 * A full-screen overlay over the mobile shell (settings, import/export) that slides in as
 * a pushed page and out as a popped one. Render it while `mounted`; put `ref` on its root.
 */
export function useOverlayTransition(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const stack = useMemo(() => (open ? [true] : []), [open]);
  const tr = useLayerTransition(stack, stack.length, (t) =>
    pickLayers(t.dir, (role) => (role === "under" ? null : ref.current), shellEl));
  return { mounted: open || tr?.dir === "pop", ref };
}

export interface SwapStep {
  frames: Keyframe[];
  duration: DurationToken | number;
  easing: EasingToken;
}

/** How a swap from one value to the next animates; null swaps at once. */
export type SwapPlan = { out: SwapStep; in: SwapStep } | null;

/**
 * Plays `out` on the element `el` names, swaps to the latest `value` once `ready`, then plays `in`.
 * Returns the value to render, which lags `value` until the swap. Instant under reduced motion and without WAAPI.
 */
export function useSwapThrough<T>(
  value: T,
  ready: boolean,
  el: () => HTMLElement | null | undefined,
  plan: (from: T, to: T) => SwapPlan,
): T {
  const [shown, setShown] = useState({ value, swap: 0 });
  const [outEnded, setOutEnded] = useState(0);
  const latest = useRef(value);
  latest.current = value;
  const elRef = useRef(el);
  elRef.current = el;
  const planRef = useRef(plan);
  planRef.current = plan;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const phase = useRef<"idle" | "out" | "held" | "in">("idle");
  const run = useRef<{ from: T; plan: SwapPlan; out: Animation | null; in: Animation | null }>({ from: value, plan: null, out: null, in: null });

  useLayoutEffect(() => {
    if (Object.is(value, shown.value) || phase.current === "out" || phase.current === "held") return;
    const node = elRef.current();
    run.current.in?.cancel();
    run.current.in = null;
    const p = planRef.current(shown.value, value);
    if (!p || !animated() || !node) {
      phase.current = "idle";
      setShown((s) => ({ value, swap: s.swap }));
      return;
    }
    phase.current = "out";
    const a = animate(node, p.out.frames, p.out.duration, p.out.easing, { fill: "forwards" });
    run.current = { from: shown.value, plan: p, out: a, in: null };
    a.finished.then(() => {
      if (run.current.out !== a) return;
      phase.current = readyRef.current ? "in" : "held";
      if (readyRef.current) setShown((s) => ({ value: latest.current, swap: s.swap + 1 }));
      else setOutEnded((n) => n + 1);
    }, () => undefined);
  }, [value, shown.value]);

  useLayoutEffect(() => {
    if (phase.current !== "held" || !ready) return;
    phase.current = "in";
    setShown((s) => ({ value: latest.current, swap: s.swap + 1 }));
  }, [outEnded, ready]);

  useLayoutEffect(() => {
    if (phase.current !== "in") return;
    const node = elRef.current();
    const { out, from } = run.current;
    run.current.out = null;
    const p = planRef.current(from, shown.value) ?? run.current.plan;
    if (!node || !p) {
      out?.cancel();
      phase.current = "idle";
      return;
    }
    const a = animate(node, p.in.frames, p.in.duration, p.in.easing);
    out?.cancel(); // once the in step holds the element, so no frame shows it at rest
    run.current.in = a;
    a.finished.then(() => {
      if (run.current.in !== a) return;
      run.current.in = null;
      phase.current = "idle";
    }, () => undefined);
  }, [shown.swap]);

  useLayoutEffect(() => () => {
    run.current.out?.cancel();
    run.current.in?.cancel();
  }, []);

  return shown.value;
}

const FADE_THROUGH: SwapPlan = {
  out: { frames: [{ opacity: 1 }, { opacity: 0 }], ...NAV_MOTION.fadeOut },
  in: { frames: [{ opacity: 0, scale: `${NAV_MOTION.fadeInScale}` }, { opacity: 1, scale: "1" }], ...NAV_MOTION.fadeIn },
};

/** M3 fade-through between tab destinations (see useSwapThrough). */
export function useFadeThrough<T>(value: T, enabled: boolean, el: () => HTMLElement | null | undefined): T {
  return useSwapThrough(value, true, el, () => (enabled ? FADE_THROUGH : null));
}

/** M3 shared axis X: forward slides the new content in from the right, back from the left. */
export function sharedAxisPlan(forward: boolean): SwapPlan {
  const dir = forward ? 1 : -1;
  const at = (px: number, opacity: number): Keyframe => ({ translate: `${px * dir}px 0px`, opacity });
  return {
    out: { frames: [at(0, 1), at(-AXIS_MOTION.outShiftPx, 0)], ...AXIS_MOTION.out },
    in: { frames: [at(AXIS_MOTION.inShiftPx, 0), at(0, 1)], ...AXIS_MOTION.in },
  };
}

/** Moving between levels of a folder or directory list (see useSwapThrough). */
export function useSharedAxis<T>(
  value: T,
  ready: boolean,
  el: () => HTMLElement | null | undefined,
  forward: (from: T, to: T) => boolean,
): T {
  return useSwapThrough(value, ready, el, (from, to) => sharedAxisPlan(forward(from, to)));
}

export type SlidePhase = "shown" | "hiding" | "hidden" | "showing";

/**
 * A bar that slides off the bottom edge when `visible` turns false and back when it
 * turns true (the mobile tab bar under a pushed page / the immersive terminal). While
 * it slides (`phase` "hiding" / "showing") take it out of the layout, so the content
 * next to it resizes once instead of on every frame. Render nothing while "hidden";
 * put `ref` on the bar. Instant under reduced motion and without WAAPI.
 */
export function useSlideAway<E extends HTMLElement>(visible: boolean) {
  const ref = useRef<E>(null);
  const [phase, setPhase] = useState<SlidePhase>(visible ? "shown" : "hidden");
  let next = phase;
  if (visible && (phase === "hidden" || phase === "hiding")) next = animated() ? "showing" : "shown";
  if (!visible && (phase === "shown" || phase === "showing")) next = animated() ? "hiding" : "hidden";
  if (next !== phase) setPhase(next); // derived during render, so the bar never misses a frame

  useLayoutEffect(() => {
    if (next !== "hiding" && next !== "showing") return;
    const el = ref.current;
    if (!el) return;
    const off = { translate: "0px 100%" };
    const on = { translate: "0px 0px" };
    const m = next === "hiding" ? NAV_MOTION.barHide : NAV_MOTION.barShow;
    const a = animate(el, next === "hiding" ? [on, off] : [off, on], m.duration, m.easing, { fill: "forwards" });
    let live = true;
    a.finished.then(() => {
      if (live) setPhase(next === "hiding" ? "hidden" : "shown");
    }, () => undefined);
    return () => {
      live = false;
      a.cancel();
    };
  }, [next]);

  return { phase: next, ref };
}
