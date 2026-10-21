import { create } from "zustand";

/**
 * Android predictive back, in-app part (the root back-to-home preview is the system's).
 *
 * NativeBack.kt forwards the gesture to `window.__voltiusBackProgress` (start /
 * progress / cancel); useAndroidBack resolves the layer the next Back would close
 * and hands it here. Following Material 3 predictive back:
 *   page / settings: shrinks to 90 %, shifts toward the swiped edge, rounds its corners;
 *   bottom sheet: shrinks slightly, anchored at the bottom.
 * Cancel springs back; the commit (handleOnBackPressed → `__voltiusBack`) fades a
 * page out then closes it, or lets a sheet play its own slide-out.
 *
 * Transform / opacity only (CSS `scale` / `translate`, which compose with the
 * components' own `transform`), plus a clip-path for the corners.
 * Reduced motion: no preview, Back just closes.
 */

/** Motion tokens of the preview, named so the shared motion module (B1) can absorb them. */
export const BACK_PREVIEW_MOTION = {
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
  /** Cancel: back to rest (M3 standard easing). */
  cancelMs: 250,
  cancelEasing: "cubic-bezier(0.2, 0, 0, 1)",
  /** Commit: the page fades out before it closes (M3 emphasized accelerate). */
  commitMs: 120,
  commitEasing: "cubic-bezier(0.3, 0, 0.8, 0.15)",
} as const;

export type BackEdge = "left" | "right" | "none";

export interface BackProgressEvent {
  phase: "start" | "progress" | "cancel";
  /** 0..1, already eased by the system. */
  progress: number;
  edge: BackEdge;
}

export type BackPreviewKind = "page" | "sheet";

export interface BackPreviewTarget {
  el: HTMLElement;
  kind: BackPreviewKind;
  /** Mount the screen under this pushed page while previewing (see useBackPeekStore). */
  peek?: boolean;
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
  const m = BACK_PREVIEW_MOTION;
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

/** True while a page preview wants the screen under the pushed page mounted (MobileShell reads it). */
export const useBackPeekStore = create<{ peek: boolean }>()(() => ({ peek: false }));

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

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  useBackPeekStore.setState({ peek: false });
}

function begin(target: BackPreviewTarget, close: () => void) {
  const { el, kind } = target;
  const rect = el.getBoundingClientRect();
  active = { target, close, saved: save(el), width: rect.width, height: rect.height };
  // Follow the finger 1:1: no CSS transition (a sheet's transition-transform covers scale/translate).
  el.style.transition = "none";
  el.style.transformOrigin = kind === "sheet" ? "50% 100%" : "50% 50%";
  if (target.peek) useBackPeekStore.setState({ peek: true });
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
  a.settling = el.animate([from, to], {
    duration: BACK_PREVIEW_MOTION.cancelMs,
    easing: BACK_PREVIEW_MOTION.cancelEasing,
  });
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
    if (reducedMotion()) return;
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
  committing = true;
  const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: BACK_PREVIEW_MOTION.commitMs,
    easing: BACK_PREVIEW_MOTION.commitEasing,
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
