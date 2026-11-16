import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { SHEET_MOTION, motionMs, springSamples, transition } from "@/lib/motion";
import { haptic } from "@/lib/haptics";
import { VelocityTracker, claimDrag, flingExit, releaseAction, rubberBand, scrimOpacity } from "./sheetDrag";

interface Gesture {
  x0: number;
  y0: number;
  /** Started on the handle, or over nothing that scrolls: drags both ways. */
  anyDirection: boolean;
  /** The scroll container under the finger (the body, or a list inside the content). */
  scroller: HTMLElement | null;
  mode: "wait" | "drag" | "pass" | "ignore";
  /** Finger y at which the sheet sits at rest (drag mode). */
  originY: number;
  lastY: number;
  offset: number;
  tracker: VelocityTracker;
}

/**
 * Mobile bottom sheet: scrim tap, Back, or a drag dismisses it. Children scroll internally.
 * Controlled: parent owns open state via onClose. All dismiss gestures route
 * through requestClose, which plays the slide-out animation and then calls
 * onClose on transition end (so the parent unmounts after the exit, not before).
 *
 * Drag (sheetDrag.ts): from the handle, or anywhere on the body once its content is
 * scrolled to the top (a scroll that reaches the top hands over to the sheet, like
 * Android's nested scrolling). The sheet follows the finger down 1:1 and rubber-bands
 * up, the scrim fades with it; on release it dismisses past 40 % of its height or on a
 * downward fling (continuing at the release speed), else springs back. The drag writes
 * the panel / scrim styles directly (no re-render per move); React owns them at rest.
 */
export default function BottomSheet({ onClose, children, title, footer }: {
  onClose: () => void;
  children: ReactNode;
  title?: string;
  footer?: ReactNode;
}) {
  const { usableHeight, offsetTop } = useVisualViewport();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Animate in
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Animate out: slide the panel fully below the viewport, then unmount.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const [exitY, setExitY] = useState(0);
  const [fling, setFling] = useState<{ duration: number; easing: string } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = (release?: { offset: number; velocity: number }) => {
    if (closingRef.current) return;
    closingRef.current = true;
    const target = (panelRef.current?.offsetHeight ?? 400) + 40;
    // A flung sheet keeps its release speed instead of restarting the exit curve.
    const exit = release ? flingExit(target - release.offset, release.velocity) : null;
    setFling(exit);
    setExitY(target);
    setClosing(true);
    // Fallback in case transitionend doesn't fire (e.g. already off-screen, or reduced motion).
    closeTimer.current = setTimeout(onClose, motionMs(exit?.duration ?? SHEET_MOTION.exit.duration) + 60);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // Hardware-back routes through the exit animation too; a predictive-back gesture shrinks the panel first.
  useBackInterceptor(true, () => requestClose(), () =>
    panelRef.current && !closing ? { el: panelRef.current, kind: "sheet" } : null);

  const translateY = closing ? exitY : entered ? 0 : 400;
  const phase = closing ? SHEET_MOTION.exit : SHEET_MOTION.enter;
  const flingMs = fling ? motionMs(fling.duration) : 0;
  const panelTransition = closing && fling
    ? `transform ${flingMs}ms ${fling.easing}`
    : transition("transform", phase.duration, phase.easing);
  const scrimTransition = closing && fling
    ? `opacity ${flingMs}ms linear`
    : transition("opacity", phase.duration, "standard");
  // What the drag hands back once the sheet is at rest again.
  const restStyles = useRef({ panelTransition, scrimTransition });
  restStyles.current = { panelTransition, scrimTransition };

  useEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    const body = bodyRef.current;
    if (!panel || !scrim || !body) return;
    let g: Gesture | null = null;
    let settling: Animation[] = [];
    let suppressClick = false;

    const place = (offset: number) => {
      panel.style.transition = "none";
      panel.style.transform = `translateY(${offset}px)`;
      scrim.style.transition = "none";
      scrim.style.opacity = String(scrimOpacity(Math.max(0, offset), panel.offsetHeight));
    };
    const stopSettle = (): number => {
      if (!settling.length) return 0;
      // Catch a settling sheet mid-flight: the drag continues from where it is.
      const m = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
      settling.forEach((a) => a.cancel());
      settling = [];
      return m.m42;
    };
    const settle = (from: number, velocity: number) => {
      const rest = restStyles.current;
      panel.style.transform = "translateY(0px)"; // the value React rendered at rest
      scrim.style.opacity = "1";
      const { duration, values } = springSamples(from, 0, velocity, SHEET_MOTION.settleOmega);
      const ms = motionMs(duration);
      const done = () => {
        settling = [];
        delete panel.dataset.mobileSheetDrag;
        panel.style.transition = rest.panelTransition;
        scrim.style.transition = rest.scrimTransition;
      };
      if (ms <= 0 || typeof panel.animate !== "function") return done();
      panel.dataset.mobileSheetDrag = "settling";
      const h = panel.offsetHeight;
      const opts = { duration: ms, easing: "linear" };
      settling = [
        panel.animate(values.map((y) => ({ transform: `translateY(${y}px)` })), opts),
        scrim.animate(values.map((y) => ({ opacity: scrimOpacity(Math.max(0, y), h) })), opts),
      ];
      settling[0].onfinish = done;
    };
    // Nearest vertically scrollable box between the touch and the panel (nested-scroll handoff).
    const scrollerAt = (from: Element | null): HTMLElement | null => {
      for (let el = from; el && el !== panel; el = el.parentElement) {
        if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
        const oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll") return el;
      }
      return null;
    };
    const startDrag = (gest: Gesture, y: number) => {
      gest.mode = "drag";
      gest.originY = y;
      panel.dataset.mobileSheetDrag = "dragging";
    };

    const onStart = (e: TouchEvent) => {
      suppressClick = false;
      if (closingRef.current || e.touches.length !== 1) { g = null; return; }
      const t = e.touches[0];
      const caught = stopSettle();
      const scroller = scrollerAt(e.target as Element);
      const anyDirection = !!handleRef.current?.contains(e.target as Node) || !scroller;
      g = {
        x0: t.clientX, y0: t.clientY, anyDirection, scroller,
        mode: "wait", originY: t.clientY, lastY: t.clientY, offset: caught,
        tracker: new VelocityTracker(),
      };
      if (caught) {
        startDrag(g, t.clientY - caught);
        g.tracker.add(e.timeStamp, t.clientY);
        place(caught);
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!g || g.mode === "ignore") return;
      const t = e.touches[0];
      if (!t) return;
      if (g.mode === "wait") {
        const dx = t.clientX - g.x0;
        const dy = t.clientY - g.y0;
        const claim = claimDrag(dx, dy, { anyDirection: g.anyDirection, scrollTop: g.scroller?.scrollTop ?? 0 });
        if (claim === "wait") return;
        if (claim === "pass") {
          g.mode = Math.abs(dx) > Math.abs(dy) ? "ignore" : "pass";
          g.lastY = t.clientY;
          return;
        }
        startDrag(g, t.clientY);
      } else if (g.mode === "pass") {
        // Nested scroll: the content reached its top and the finger keeps pulling down.
        const pullingDown = t.clientY > g.lastY;
        g.lastY = t.clientY;
        if (!(pullingDown && (g.scroller?.scrollTop ?? 0) <= 0)) return;
        startDrag(g, t.clientY);
      }
      if (e.cancelable) e.preventDefault();
      const dy = t.clientY - g.originY;
      if (dy < 0 && !g.anyDirection) {
        // Pushed back up to rest: hand the gesture back to the scroller.
        g.mode = "pass";
        g.lastY = t.clientY;
        g.tracker.reset();
        g.offset = 0;
        place(0);
        return;
      }
      if (g.scroller && g.scroller.scrollTop > 0) g.scroller.scrollTop = 0; // the sheet moves, not its content
      g.offset = rubberBand(dy);
      g.tracker.add(e.timeStamp, t.clientY);
      place(g.offset);
    };
    const onEnd = (e: TouchEvent) => {
      const done = g;
      g = null;
      if (!done || done.mode !== "drag") return;
      suppressClick = true; // the lift after a drag is not a tap on the row under it
      const released = e.type === "touchend";
      const velocity = released ? done.tracker.velocity(e.timeStamp) : 0;
      if (released && releaseAction(done.offset, velocity, panel.offsetHeight) === "dismiss") {
        haptic("gesture");
        requestCloseRef.current({ offset: Math.max(0, done.offset), velocity });
      } else {
        settle(done.offset, velocity);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    panel.addEventListener("click", onClick, true);
    return () => {
      settling.forEach((a) => a.cancel());
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
      panel.removeEventListener("click", onClick, true);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-40 flex flex-col justify-end"
      data-mobile-sheet
      // Track the visual viewport, not the layout viewport: when an input autofocuses, this
      // WebView scrolls the layout viewport under the keyboard (visualViewport.offsetTop > 0,
      // window.innerHeight unchanged) rather than insetting it. A bare `top: 0` then anchors the
      // sheet offsetTop px above the visible area and `justify-end` floats the panel near the top
      // of the screen. Offsetting top by offsetTop + sizing to usableHeight (== visual height)
      // pins the container to the visible region, so the panel sits flush above the keyboard.
      // Keyboard closed: offsetTop is 0 and usableHeight is the full height — identical to before.
      style={{ top: offsetTop, height: usableHeight > 0 ? usableHeight : "100%" }}
    >
      <div
        ref={scrimRef}
        className="absolute inset-0"
        data-mobile-sheet-scrim
        style={{
          background: "rgba(0,0,0,0.5)",
          opacity: entered && !closing ? 1 : 0,
          transition: scrimTransition,
        }}
        onClick={() => requestClose()}
      />
      <div
        ref={panelRef}
        className="relative rounded-t-2xl max-h-[80%] flex flex-col"
        data-mobile-sheet-panel
        style={{
          background: "var(--t-bg-elevated)",
          border: "1px solid var(--t-border)",
          transform: `translateY(${translateY}px)`,
          transition: panelTransition,
          paddingBottom: "var(--vt-safe-bottom)",
        }}
        onTransitionEnd={(e) => {
          if (closing && e.target === e.currentTarget && e.propertyName === "transform") {
            if (closeTimer.current) clearTimeout(closeTimer.current);
            onClose();
          }
        }}
      >
        <div
          ref={handleRef}
          className={`shrink-0 flex flex-col items-center pt-2 pb-1${title ? " min-h-12" : ""}`}
          style={{ touchAction: "none" }}
          data-mobile-sheet-handle
        >
          <div className="w-9 h-1 rounded-full" style={{ background: "var(--t-border)" }} />
          {title && <div className="text-sm font-semibold mt-2 text-(--t-text-primary)">{title}</div>}
        </div>
        <div ref={bodyRef} className="overflow-y-auto overscroll-contain px-2 pb-2" data-mobile-sheet-body>
          {children}
        </div>
        {footer && <div className="shrink-0" data-mobile-sheet-footer>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
