import { useEffect, useRef, useState } from "react";
import { getTerminalApi } from "@/hooks/useTerminal";
import { sendSpecialKey } from "@/services/terminalInput";
import { isDoubleTap, type TapPoint } from "./doubleTap";
import {
  cellFromPoint,
  linesFromPixelDelta,
  wordRangeAt,
  isBlankCell,
  extendSelection,
  type Cell,
  type CellMetrics,
} from "./mobileTerminalGestures";
import { writeClipboard, readClipboard } from "@/utils/clipboard";

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
  const [toolbar, setToolbar] = useState<{ x: number; y: number; mode: "select" | "paste" } | null>(null);
  const toolbarOpen = useRef(false);
  const anchorStart = useRef<Cell | null>(null);
  const anchorEnd = useRef<Cell | null>(null);

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

    const closeToolbar = () => {
      setToolbar(null);
      anchorStart.current = null;
      anchorEnd.current = null;
    };

    const showPaste = (x: number, y: number) => {
      setToolbar({ x, y, mode: "paste" });
    };

    const showSelectionToolbar = () => {
      const api = getTerminalApi(sessionId);
      const m = metrics();
      const pos = api?.getSelectionPosition();
      if (!api || !m || !pos) return;
      const left = m.left + pos.start.x * m.cellWidth;
      const top = m.top + (pos.start.y - m.viewportTop) * m.cellHeight;
      setToolbar({ x: left, y: top, mode: "select" });
    };

    const onLongPress = (x: number, y: number) => {
      const api = getTerminalApi(sessionId);
      const m = metrics();
      if (!api || !m) return;
      const cell = cellFromPoint(m, x, y);
      const text = api.lineText(cell.line);
      if (isBlankCell(text, cell.col)) {
        showPaste(x, y);
        return;
      }
      const word = wordRangeAt(text, cell.col);
      if (word.len === 0) { showPaste(x, y); return; }
      phase.current = "selecting";
      anchorStart.current = { col: word.startCol, line: cell.line };
      anchorEnd.current = { col: word.startCol + word.len - 1, line: cell.line };
      api.select(word.startCol, cell.line, word.len);
    };

    const reset = () => {
      phase.current = "idle";
      start.current = null;
      carry.current = 0;
      longPressFired.current = false;
      clearLongPress();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (toolbarOpen.current) {
        const target = e.target as Element | null;
        if (target?.closest("[data-mobile-term-toolbar]")) return; // let the toolbar button handle its own tap
        getTerminalApi(sessionId)?.clearSelection();
        closeToolbar();
      }
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
      if (phase.current === "selecting") {
        e.preventDefault();
        const m = metrics();
        const api = getTerminalApi(sessionId);
        if (!m || !api || !anchorStart.current || !anchorEnd.current) return;
        const focus = cellFromPoint(m, t.clientX, t.clientY);
        const sel = extendSelection(anchorStart.current, anchorEnd.current, focus);
        if (sel.kind === "line") api.select(sel.startCol, sel.line, sel.len);
        else api.selectLines(sel.start, sel.end);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPress();
      const wasPhase = phase.current;

      if (longPressFired.current) {
        e.preventDefault();
        e.stopPropagation();
        if (wasPhase === "selecting") showSelectionToolbar();
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

  useEffect(() => { toolbarOpen.current = toolbar !== null; }, [toolbar]);

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
      {toolbar && (
        <div
          data-mobile-term-toolbar
          className="absolute pointer-events-auto flex items-center gap-1 rounded-lg p-1"
          style={{
            left: `${Math.max(8, Math.min(toolbar.x, window.innerWidth - 160))}px`,
            top: `${Math.max(8, toolbar.y - 44)}px`,
            background: "var(--t-bg-modal)",
            border: "1px solid var(--t-border-hover)",
            boxShadow: "var(--t-elev-2)",
          }}
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
        >
          {toolbar.mode === "select" && (
            <>
              <button
                data-toolbar-copy
                className="px-3 py-1.5 rounded-md text-xs font-medium text-(--t-text-primary)"
                onClick={() => {
                  const sel = getTerminalApi(sessionId)?.getSelection();
                  if (sel) void writeClipboard(sel);
                  getTerminalApi(sessionId)?.clearSelection();
                  setToolbar(null);
                  anchorStart.current = null;
                  anchorEnd.current = null;
                }}
              >
                Copy
              </button>
              <button
                data-toolbar-selectall
                className="px-3 py-1.5 rounded-md text-xs font-medium text-(--t-text-primary)"
                onClick={() => getTerminalApi(sessionId)?.selectAll()}
              >
                All
              </button>
            </>
          )}
          <button
            data-toolbar-paste
            className="px-3 py-1.5 rounded-md text-xs font-medium text-(--t-text-primary)"
            onClick={() => {
              void readClipboard().then((text) => {
                if (text) getTerminalApi(sessionId)?.paste(text);
              });
              getTerminalApi(sessionId)?.clearSelection();
              setToolbar(null);
              anchorStart.current = null;
              anchorEnd.current = null;
            }}
          >
            Paste
          </button>
        </div>
      )}
    </div>
  );
}
