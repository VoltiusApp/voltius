import { useEffect, useRef, useState } from "react";
import { getTerminalApi } from "@/hooks/useTerminal";
import { sendSpecialKey } from "@/services/terminalInput";
import { isDoubleTap, type TapPoint } from "./doubleTap";
import {
  linesFromPixelDelta,
  type CellMetrics,
} from "./mobileTerminalGestures";

const LONG_PRESS_MS = 380;
const MOVE_THRESHOLD_PX = 10;
const DOUBLE_TAP = { ms: 300, px: 24 };

type Phase = "idle" | "pending" | "scrolling" | "selecting";

/**
 * Mobile-only unified terminal gesture layer. One-finger immediate drag scrolls;
 * a long-press selects (on text) or pastes (on blank). Double-tap sends Tab.
 * Single taps pass through to xterm (focus → keyboard). Attaches capture-phase
 * touch listeners to the terminal container so it can pre-empt xterm's own
 * synthesized mouse handling for consumed gestures.
 */
export default function MobileTerminalGestures({ sessionId, active }: { sessionId: string; active: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hintKey, setHintKey] = useState(0);

  // Gesture state (refs — never trigger re-render mid-gesture).
  const phase = useRef<Phase>("idle");
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastY = useRef(0);
  const carry = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const lastTap = useRef<TapPoint | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = rootRef.current?.parentElement;
    if (!container) return;

    const metrics = (): CellMetrics | null => {
      const api = getTerminalApi(sessionId);
      const el = api?.screenEl();
      if (!api || !el) return null;
      const r = el.getBoundingClientRect();
      const cols = api.cols();
      const rows = api.rows();
      if (!cols || !rows) return null;
      return {
        left: r.left,
        top: r.top,
        cellWidth: r.width / cols,
        cellHeight: r.height / rows,
        cols,
        rows,
        viewportTop: api.viewportTop(),
      };
    };

    const clearLongPress = () => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    };

    // Filled in by Task 5/6; no-op here so scroll/tap work standalone.
    const onLongPress = (_x: number, _y: number) => {};

    const reset = () => {
      phase.current = "idle";
      start.current = null;
      carry.current = 0;
      longPressFired.current = false;
      clearLongPress();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { reset(); return; }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      lastY.current = t.clientY;
      carry.current = 0;
      longPressFired.current = false;
      phase.current = "pending";
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        if (phase.current !== "pending" || !start.current) return;
        longPressFired.current = true;
        onLongPress(start.current.x, start.current.y);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      const s = start.current;
      const t = e.touches[0];
      if (!s || !t) return;

      if (phase.current === "pending") {
        const moved = Math.hypot(t.clientX - s.x, t.clientY - s.y);
        if (moved > MOVE_THRESHOLD_PX) {
          clearLongPress();
          phase.current = "scrolling";
          lastY.current = t.clientY;
        } else {
          return;
        }
      }

      if (phase.current === "scrolling") {
        e.preventDefault();
        const m = metrics();
        if (!m) return;
        const dy = t.clientY - lastY.current;
        lastY.current = t.clientY;
        const acc = linesFromPixelDelta(dy, m.cellHeight, carry.current);
        carry.current = acc.carry;
        if (acc.lines !== 0) getTerminalApi(sessionId)?.scrollLines(-acc.lines);
      }
      // phase "selecting" handled in Task 5.
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPress();
      const wasPhase = phase.current;

      if (longPressFired.current) {
        // A long-press already consumed this gesture (select/paste, Task 5/6):
        // swallow the synthesized click so the keyboard never pops.
        e.preventDefault();
        e.stopPropagation();
        reset();
        return;
      }

      if (wasPhase === "scrolling") {
        e.preventDefault();
        reset();
        return;
      }

      if (wasPhase === "pending") {
        // No movement, no long-press → a tap. Check double-tap → Tab.
        const t = e.changedTouches[0];
        if (t) {
          const now: TapPoint = { t: e.timeStamp, x: t.clientX, y: t.clientY };
          const prev = lastTap.current;
          if (prev && isDoubleTap(prev, now, DOUBLE_TAP)) {
            e.preventDefault();
            e.stopPropagation();
            lastTap.current = null; // a triple-tap is not two double-taps
            sendSpecialKey(sessionId, "Tab", { ctrl: false, alt: false });
            setHintKey((k) => k + 1);
            reset();
            return;
          }
          lastTap.current = now;
        }
      }
      reset();
    };

    const onTouchCancel = () => reset();

    const opts: AddEventListenerOptions = { capture: true, passive: false };
    container.addEventListener("touchstart", onTouchStart, opts);
    container.addEventListener("touchmove", onTouchMove, opts);
    container.addEventListener("touchend", onTouchEnd, opts);
    container.addEventListener("touchcancel", onTouchCancel, opts);
    return () => {
      const rm: EventListenerOptions = { capture: true };
      container.removeEventListener("touchstart", onTouchStart, rm);
      container.removeEventListener("touchmove", onTouchMove, rm);
      container.removeEventListener("touchend", onTouchEnd, rm);
      container.removeEventListener("touchcancel", onTouchCancel, rm);
      clearLongPress();
      lastTap.current = null;
    };
  }, [active, sessionId]);

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
      {hintKey > 0 && (
        <span
          key={hintKey}
          data-tab-hint
          className="animate-tab-hint rounded-full px-3 py-1 text-sm font-semibold"
          style={{
            background: "color-mix(in srgb, var(--t-bg-base) 80%, #000 20%)",
            color: "var(--t-text-bright)",
            border: "1px solid var(--t-border)",
          }}
        >
          Tab
        </span>
      )}
    </div>
  );
}
