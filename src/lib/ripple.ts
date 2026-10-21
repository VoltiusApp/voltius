import { DURATION, EASING, prefersReducedMotion } from "@/lib/motion";

/**
 * Material ripples + pressed state layer for the Android shell, by event delegation:
 * one pointerdown listener on the document covers every row, button and key, so no
 * component has to opt in. On touch-down a state layer (currentColor, see globals.css
 * `.vt-ripple`) appears over the pressed control and a ripple grows from the touch
 * point; release lets it finish and fade. Moving past the touch slop (a scroll) or a
 * pointercancel drops both at once, so scrolling a list never leaves ripples behind.
 * Reduced motion: state layer only, no ripple.
 *
 * Opt out with `data-no-ripple` on the control or any ancestor; opt in a non-button
 * with `data-ripple`. The terminal, text fields and disabled controls are skipped.
 */

/** What gets feedback: anything tappable. */
export const RIPPLE_TARGETS = 'button, [role="button"], [role="menuitem"], [role="tab"], [role="option"], a[href], summary, [data-ripple]';
/** Never: text entry (caret / selection gestures), the terminal surface, opted-out subtrees. */
const SKIP = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm, [data-no-ripple]';
/** Android touch slop: further than this from the touch-down is a scroll / drag, not a tap. */
export const TOUCH_SLOP_PX = 8;

export const RIPPLE_MOTION = {
  /** The circle covers the control in this time; the fade waits for it so a quick tap still shows it. */
  grow: { duration: DURATION.medium2, easing: EASING.standard },
  fade: { duration: DURATION.short4, easing: EASING.linear },
  /** Cancelled (scroll): gone fast. */
  cancel: { duration: DURATION.short2, easing: EASING.linear },
} as const;

/** The control a touch-down on `target` gives feedback to, or null. */
export function rippleTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(RIPPLE_TARGETS);
  if (!el || el.closest(SKIP)) return null;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

/** Ripple geometry for a box and a touch point inside it: a circle centred on the touch that reaches the farthest corner. */
export function rippleCircle(width: number, height: number, x: number, y: number) {
  const r = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  return { size: r * 2, left: x - r, top: y - r };
}

/** Small square controls without corners of their own (icon buttons) get a round state layer. */
const isIconButton = (el: HTMLElement, w: number, h: number) =>
  w <= 56 && h <= 56 && Math.abs(w - h) <= 8 && parseFloat(getComputedStyle(el).borderTopLeftRadius) === 0;

interface Press {
  pointerId: number;
  x: number;
  y: number;
  layer: HTMLSpanElement;
  wave: HTMLSpanElement | null;
  grown: Promise<void>;
  restorePosition: string | null;
}

function startPress(el: HTMLElement, e: PointerEvent): Press {
  const rect = el.getBoundingClientRect();
  let restorePosition: string | null = null;
  if (getComputedStyle(el).position === "static") {
    restorePosition = el.style.position;
    el.style.position = "relative";
  }
  const layer = document.createElement("span");
  layer.className = "vt-ripple";
  layer.setAttribute("aria-hidden", "true");
  if (isIconButton(el, rect.width, rect.height)) layer.style.borderRadius = "9999px";
  layer.dataset.pressed = "";
  let wave: HTMLSpanElement | null = null;
  let grown = Promise.resolve();
  if (!prefersReducedMotion() && typeof layer.animate === "function") {
    const c = rippleCircle(rect.width, rect.height, e.clientX - rect.left, e.clientY - rect.top);
    wave = document.createElement("span");
    wave.style.cssText = `width:${c.size}px;height:${c.size}px;left:${c.left}px;top:${c.top}px`;
    layer.append(wave);
    const g = RIPPLE_MOTION.grow;
    grown = wave
      .animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: g.duration, easing: g.easing, fill: "forwards" })
      .finished.then(() => undefined, () => undefined);
  }
  el.append(layer);
  return { pointerId: e.pointerId, x: e.clientX, y: e.clientY, layer, wave, grown, restorePosition };
}

function endPress(el: HTMLElement, p: Press, cancelled: boolean) {
  const m = cancelled ? RIPPLE_MOTION.cancel : RIPPLE_MOTION.fade;
  const remove = () => {
    p.layer.remove();
    if (p.restorePosition !== null && !el.querySelector(":scope > .vt-ripple")) el.style.position = p.restorePosition;
  };
  delete p.layer.dataset.pressed; // the state layer fades out through its CSS transition
  const fade = () => {
    if (prefersReducedMotion() || typeof p.layer.animate !== "function") return remove();
    p.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: m.duration, easing: m.easing, fill: "forwards" }).finished.then(remove, remove);
  };
  // A tap lets the ripple cover the control before it fades; a cancel fades at once.
  if (cancelled || !p.wave) fade();
  else void p.grown.then(fade);
}

/** Installs the delegated ripples on `doc`. Returns the uninstaller. */
export function installRipples(doc: Document = document): () => void {
  let active: { el: HTMLElement; press: Press } | null = null;
  const finish = (cancelled: boolean) => {
    if (!active) return;
    endPress(active.el, active.press, cancelled);
    active = null;
  };
  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button > 0) return;
    finish(true);
    const el = rippleTarget(e.target);
    if (el) active = { el, press: startPress(el, e) };
  };
  const onMove = (e: PointerEvent) => {
    if (active && e.pointerId === active.press.pointerId &&
        Math.hypot(e.clientX - active.press.x, e.clientY - active.press.y) > TOUCH_SLOP_PX) finish(true);
  };
  const onUp = (e: PointerEvent) => {
    if (active && e.pointerId === active.press.pointerId) finish(false);
  };
  const onCancel = (e: PointerEvent) => {
    if (active && e.pointerId === active.press.pointerId) finish(true);
  };
  const opts = { capture: true, passive: true } as const;
  doc.addEventListener("pointerdown", onDown, opts);
  doc.addEventListener("pointermove", onMove, opts);
  doc.addEventListener("pointerup", onUp, opts);
  doc.addEventListener("pointercancel", onCancel, opts);
  return () => {
    finish(true);
    doc.removeEventListener("pointerdown", onDown, opts);
    doc.removeEventListener("pointermove", onMove, opts);
    doc.removeEventListener("pointerup", onUp, opts);
    doc.removeEventListener("pointercancel", onCancel, opts);
  };
}
