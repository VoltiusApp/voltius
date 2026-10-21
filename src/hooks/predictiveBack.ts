import { create } from "zustand";
import { BACK_PREVIEW, PAGE_MOTION, animate, motionMs, prefersReducedMotion } from "@/lib/motion";

/**
 * Android predictive back, in-app part (the root back-to-home preview is the system's).
 *
 * NativeBack.kt forwards the gesture to `window.__voltiusBackProgress` (start /
 * progress / cancel); useAndroidBack resolves the layer the next Back would close
 * and hands it here. Following Material 3 predictive back:
 *   page / settings: shrinks to 90 %, shifts toward the swiped edge, rounds its corners;
 *   bottom sheet: shrinks slightly, anchored at the bottom.
 * Cancel springs back; the commit (handleOnBackPressed → `__voltiusBack`) closes the
 * layer: a `handoff` page keeps its pose for the page transition to continue from
 * (pageTransition.ts), another page fades out first, a sheet plays its own slide-out.
 *
 * Transform / opacity only (CSS `scale` / `translate`, which compose with the
 * components' own `transform`), plus a clip-path for the corners.
 * Reduced motion: no preview, Back just closes. Geometry and timing: BACK_PREVIEW (lib/motion).
 */

export type BackEdge = "left" | "right" | "none";

export interface BackProgressEvent {
  phase: "start" | "progress" | "cancel";
  /** 0..1, already eased by the system. */
  progress: number;
  edge: BackEdge;
}

export type BackPreviewKind = "page" | "sheet";

/** Which layer mounts what lies under its top page while previewing: the nav stack or the settings sub-pages. */
export type PeekLayer = "stack" | "settings";

export interface BackPreviewTarget {
  el: HTMLElement;
  kind: BackPreviewKind;
  /** Mount what lies under this page while previewing (see useBackPeekStore). */
  peek?: PeekLayer;
  /** The close plays a page transition that continues from the gesture's pose (pageTransition.ts). */
  handoff?: boolean;
}

export interface BackPreviewFrame {
  scaleX: number;
  scaleY: number;
  x: number;
  /** Corner radius in px; undefined leaves the element's own radius alone. */
  radius?: number;
}

/** Pure frame for `progress` on a `width` × `height` layer. */
export function previewFrame(
  kind: BackPreviewKind,
  progress: number,
  edge: BackEdge,
  width: number,
  height: number,
): BackPreviewFrame {
  const m = BACK_PREVIEW;
  const p = Math.min(1, Math.max(0, progress));
  if (kind === "sheet") {
    return {
      scaleX: width > 0 ? 1 - (p * m.sheetShrinkXPx) / width : 1,
      scaleY: height > 0 ? 1 - (p * m.sheetShrinkYPx) / height : 1,
      x: 0,
    };
  }
  const scale = 1 - p * (1 - m.pageMinScale);
  const dir = edge === "left" ? 1 : edge === "right" ? -1 : 0;
  const maxShift = Math.max(0, width / m.pageShiftDivisor - m.pageShiftMarginPx);
  return { scaleX: scale, scaleY: scale, x: dir * p * maxShift, radius: m.pageCornerPx * Math.min(1, p * 4) };
}

/** The layer whose page under the top one must be mounted during a preview (MobileShell, MobileSettings read it). */
export const useBackPeekStore = create<{ peek: PeekLayer | null }>()(() => ({ peek: null }));

// Corners via clip-path, not border-radius + overflow: flipping a scroller's overflow would reset its scroll.
const STYLE_KEYS = ["scale", "translate", "clipPath", "transformOrigin", "transition"] as const;
type SavedStyle = Record<(typeof STYLE_KEYS)[number], string>;

interface Active {
  target: BackPreviewTarget;
  /** What the gesture would close, fixed at start so a peeked screen can't change it. */
  close: () => void;
  saved: SavedStyle;
  width: number;
  height: number;
  settling?: Animation;
}

let active: Active | null = null;
let committing = false;

const save = (el: HTMLElement): SavedStyle =>
  Object.fromEntries(STYLE_KEYS.map((k) => [k, el.style[k]])) as SavedStyle;

const corners = (r: number) => `inset(0 round ${r}px)`;

const restore = (el: HTMLElement, saved: SavedStyle) => {
  for (const k of STYLE_KEYS) el.style[k] = saved[k];
};

function finish() {
  if (!active) return;
  active.settling?.cancel();
  restore(active.target.el, active.saved);
  active = null;
  useBackPeekStore.setState({ peek: null });
}

function begin(target: BackPreviewTarget, close: () => void) {
  const { el, kind } = target;
  const rect = el.getBoundingClientRect();
  active = { target, close, saved: save(el), width: rect.width, height: rect.height };
  // Follow the finger 1:1: no CSS transition (a sheet's transition-transform covers scale/translate).
  el.style.transition = "none";
  el.style.transformOrigin = kind === "sheet" ? "50% 100%" : "50% 50%";
  if (target.peek) useBackPeekStore.setState({ peek: target.peek });
}

function apply(a: Active, progress: number, edge: BackEdge) {
  const f = previewFrame(a.target.kind, progress, edge, a.width, a.height);
  const st = a.target.el.style;
  st.scale = `${f.scaleX} ${f.scaleY}`;
  st.translate = `${f.x}px 0px`;
  if (f.radius !== undefined) st.clipPath = corners(f.radius);
}

function cancel(a: Active) {
  const { el } = a.target;
  const from: Keyframe = { scale: el.style.scale || "1", translate: el.style.translate || "0px 0px" };
  const to: Keyframe = { scale: "1", translate: "0px 0px" };
  if (a.target.kind === "page") {
    from.clipPath = el.style.clipPath || corners(0);
    to.clipPath = corners(0);
  }
  el.style.scale = "";
  el.style.translate = "";
  el.style.clipPath = a.saved.clipPath;
  a.settling = animate(el, [from, to], BACK_PREVIEW.cancel.duration, BACK_PREVIEW.cancel.easing);
  a.settling.onfinish = () => {
    if (active === a) finish();
  };
}

/**
 * Gesture events from native. `resolve` names the layer the next Back closes (null:
 * nothing to animate, e.g. a popover or a tab switch) and the close to run on commit.
 */
export function onBackProgress(
  ev: BackProgressEvent,
  resolve: () => { target: BackPreviewTarget | null; close: () => void } | null,
) {
  if (committing) return;
  if (ev.phase === "start") {
    finish();
    if (prefersReducedMotion()) return;
    const r = resolve();
    if (!r?.target) return;
    begin(r.target, r.close);
  }
  if (!active) return;
  if (ev.phase === "cancel") cancel(active);
  else apply(active, ev.progress, ev.edge);
}

/**
 * Back was committed. With a preview showing, finish it with the close it was
 * previewing and return true; otherwise return false (the caller closes plainly).
 */
export function commitBackPreview(): boolean {
  if (committing) return true; // a press during the fade-out: already closing
  const a = active;
  if (!a || a.settling) {
    finish();
    return false;
  }
  const { el, kind } = a.target;
  if (kind === "sheet") {
    // The sheet slides itself out: hand its transition back, keep the shrink.
    el.style.transition = a.saved.transition;
    active = null;
    a.close();
    return true;
  }
  if (a.target.handoff) {
    // The pop transition takes the pose over and the layer unmounts after it; the peeked
    // layer under it is kept mounted by that transition, so the peek can end now.
    active = null;
    a.close();
    useBackPeekStore.setState({ peek: null });
    // Safety net: a close that played no transition must not leave the page shrunk.
    setTimeout(() => {
      if (el.isConnected && el.style.scale) restore(el, a.saved);
    }, motionMs(PAGE_MOTION.popFront.duration) + 150);
    return true;
  }
  committing = true;
  const fade = animate(el, [{ opacity: 1 }, { opacity: 0 }], BACK_PREVIEW.commit.duration, BACK_PREVIEW.commit.easing, {
    fill: "forwards",
  });
  fade.onfinish = () => {
    a.close();
    // Let React swap the layer out before a surviving element (settings body) is reset.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        fade.cancel();
        committing = false;
        if (active === a) finish();
      }),
    );
  };
  return true;
}
