import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { focusSession, getTerminalApi } from "@/hooks/useTerminal";
import { sendSpecialKey } from "@/services/terminalInput";
import { showAndroidKeyboard, hideAndroidKeyboard, setAndroidKeyboardTarget, setSelectionTouchFeed } from "@/services/androidKeyboard";
import { useIsAndroid } from "@/utils/platform";
import { isDoubleTap, type TapPoint } from "./doubleTap";
import { fontSizeFromPinch, linesFromPixelDelta, touchDistance } from "./mobileTerminalGesturesCore";
import { createNativeSelection } from "./nativeSelectionOverlay";
import { readClipboard } from "@/utils/clipboard";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE, useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { haptic } from "@/lib/haptics";
import { animate, motionMs, SESSION_MOTION } from "@/lib/motion";
import { useSessionStore } from "@/stores/sessionStore";
import { VelocityTracker } from "./sheets/sheetDrag";
import { adjacentSessionId, claimSwipeAxis, inEdgeZone, sessionSwipeStep, SWIPE_FOLLOW } from "./sessionSwipeCore";

const LONG_PRESS_MS = 380;
const DOUBLE_TAP = { ms: 300, px: 24 };

type Phase = "idle" | "pending" | "scrolling" | "swiping" | "native" | "pinching";

/** Terminal sessions in chip order (the top bar hides multiplayer ones too). */
const sessionIds = () => useSessionStore.getState().sessions.filter((s) => s.type !== "multiplayer").map((s) => s.id);

/** Mobile terminal gestures: drag scrolls, a sideways swipe switches session, long-press selects
 *  natively (Paste on blank), double-tap sends Tab, pinch sets the font size (#159); single taps
 *  reach xterm. */
export default function MobileTerminalGestures({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { t } = useTranslation();
  const isAndroid = useIsAndroid();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hintKey, setHintKey] = useState(0);
  const [paste, setPaste] = useState<{ x: number; y: number } | null>(null);
  const pasteOpen = useRef(false);

  const phase = useRef<Phase>("idle");
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const onText = useRef(false);
  const lastY = useRef(0);
  const carry = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const lastTap = useRef<TapPoint | null>(null);
  const pinch = useRef<{ dist: number; size: number } | null>(null);
  const swipeVelocity = useRef(new VelocityTracker());

  const cellHeight = (): number => {
    const api = getTerminalApi(sessionId);
    const rows = api?.rows();
    const h = api?.screenEl()?.getBoundingClientRect().height;
    return rows && h ? h / rows : 0;
  };

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const container = root?.parentElement;
    if (!root || !container) return;
    const sel = createNativeSelection(root, () => getTerminalApi(sessionId), (on) => {
      if (isAndroid) setSelectionTouchFeed(on);
    });
    const w = window as unknown as { __voltiusSelTouch?: (y: number | null) => void };
    const onFinger = (y: number | null) => sel.finger(y);
    w.__voltiusSelTouch = onFinger;

    const clearLongPress = () => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    };

    const showPaste = (x: number, y: number) => {
      const r = rootRef.current?.getBoundingClientRect();
      setPaste({ x: x - (r?.left ?? 0), y: y - (r?.top ?? 0) });
    };

    // Sideways swipe: the terminal follows the finger a little; release switches or settles back.
    const follow = (dx: number) => { container.style.transform = dx ? `translateX(${dx * SWIPE_FOLLOW}px)` : ""; };
    const endSwipe = (dx: number, t: number) => {
      const step = sessionSwipeStep(dx, swipeVelocity.current.velocity(t), container.clientWidth || window.innerWidth);
      const target = adjacentSessionId(sessionIds(), sessionId, step);
      if (target) {
        haptic("tick");
        useSessionStore.getState().setActive(target);
        // MobileSessionLayer slides this session out from where the finger left it; drop the
        // follow offset once it is hidden again.
        setTimeout(() => follow(0), motionMs(SESSION_MOTION.exit.duration) + 50);
        return;
      }
      const from = container.style.transform;
      follow(0);
      if (from && typeof container.animate === "function") {
        animate(container, [{ transform: from }, { transform: "none" }], SESSION_MOTION.snapBack.duration, SESSION_MOTION.snapBack.easing);
      }
    };

    const reset = () => {
      phase.current = "idle";
      pinch.current = null;
      start.current = null;
      onText.current = false;
      carry.current = 0;
      longPressFired.current = false;
      clearLongPress();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (sel.isSelecting()) { reset(); return; }
      if (pasteOpen.current) {
        if ((e.target as Element | null)?.closest("[data-mobile-term-toolbar]")) return;
        setPaste(null);
      }
      if (e.touches.length === 2) {
        if (phase.current === "swiping") follow(0);
        clearLongPress();
        sel.disarm();
        longPressFired.current = false;
        phase.current = "pinching";
        pinch.current = {
          dist: touchDistance(e.touches[0], e.touches[1]),
          size: useThemeStore.getState().getActiveTheme().terminalFontSize,
        };
        return;
      }
      if (e.touches.length !== 1) { sel.disarm(); reset(); return; }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      lastY.current = t.clientY;
      carry.current = 0;
      longPressFired.current = false;
      phase.current = "pending";
      sel.arm();
      onText.current = sel.hitsText(t.clientX, t.clientY);
      // Mouse-reporting apps need short taps on the canvas, so arm only once the press is long.
      if (!onText.current || getTerminalApi(sessionId)?.mouseMode()) sel.disarm();
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        if (phase.current !== "pending" || !start.current) return;
        longPressFired.current = true;
        haptic("press");
        if (onText.current) {
          phase.current = "native";
          sel.arm();
          if (isAndroid) hideAndroidKeyboard(true);
        } else {
          showPaste(start.current.x, start.current.y);
        }
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (phase.current === "native" || sel.isSelecting()) return;
      if (phase.current === "pinching") {
        const p = pinch.current;
        if (!p || e.touches.length < 2) return;
        e.preventDefault();
        const size = fontSizeFromPinch(
          p.size,
          p.dist,
          touchDistance(e.touches[0], e.touches[1]),
          MIN_TERMINAL_FONT_SIZE,
          MAX_TERMINAL_FONT_SIZE,
        );
        if (size !== useThemeStore.getState().getActiveTheme().terminalFontSize) {
          useUIStore.getState().setTerminalFontSize(size);
        }
        return;
      }

      const s = start.current;
      const t = e.touches[0];
      if (!s || !t) return;

      if (phase.current === "pending") {
        const axis = claimSwipeAxis(t.clientX - s.x, t.clientY - s.y);
        if (!axis) return;
        clearLongPress();
        sel.disarm();
        // Sideways = session swipe, unless it started in the system back-gesture strips or
        // there is nowhere to go; anything else (diagonals too) scrolls the scrollback.
        if (axis === "x" && sessionIds().length > 1 && !inEdgeZone(s.x, window.innerWidth)) {
          phase.current = "swiping";
          swipeVelocity.current.reset();
        } else {
          phase.current = "scrolling";
          lastY.current = t.clientY;
        }
      }

      if (phase.current === "swiping") {
        e.preventDefault();
        swipeVelocity.current.add(e.timeStamp, t.clientX);
        follow(t.clientX - s.x);
        return;
      }

      if (phase.current === "scrolling") {
        e.preventDefault();
        const ch = cellHeight();
        if (!ch) return;
        const dy = t.clientY - lastY.current;
        lastY.current = t.clientY;
        const acc = linesFromPixelDelta(dy, ch, carry.current);
        carry.current = acc.carry;
        if (acc.lines !== 0) getTerminalApi(sessionId)?.scrollLines(-acc.lines);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPress();
      const wasPhase = phase.current;

      if (wasPhase === "native" || sel.isSelecting()) {
        sel.disarm();
        reset();
        return;
      }

      if (wasPhase === "pinching") {
        e.preventDefault();
        // The lifted finger must not be read as the start of a tap or a scroll.
        if (e.touches.length === 0) reset();
        return;
      }

      if (wasPhase === "swiping") {
        e.preventDefault();
        const t = e.changedTouches[0];
        const s = start.current;
        if (t && s) swipeVelocity.current.add(e.timeStamp, t.clientX);
        endSwipe(t && s ? t.clientX - s.x : 0, e.timeStamp);
        reset();
        return;
      }

      if (longPressFired.current || wasPhase === "scrolling") {
        e.preventDefault();
        if (longPressFired.current) e.stopPropagation();
        reset();
        return;
      }

      // Drop the overlay before the tap's click is dispatched so it lands on xterm.
      sel.disarm();
      if (wasPhase === "pending") {
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
        // Plain tap: xterm's textarea has inputmode=none on Android, so raise the native
        // keyboard overlay ourselves (idempotent; see services/androidKeyboard.ts). iOS has no
        // overlay: focusing xterm's textarea inside the tap raises the system keyboard.
        if (isAndroid) showAndroidKeyboard(sessionId);
        else focusSession(sessionId);
      }
      reset();
    };

    const onTouchCancel = () => {
      if (phase.current === "swiping") endSwipe(0, 0);
      sel.disarm();
      reset();
    };

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
      sel.dispose();
      if (w.__voltiusSelTouch === onFinger) delete w.__voltiusSelTouch;
      setPaste(null);
    };
  }, [active, sessionId, isAndroid]);

  // Route native IME input to the active session; dismiss the keyboard when this terminal is
  // no longer the active one.
  useEffect(() => {
    if (!isAndroid) return;
    if (active) setAndroidKeyboardTarget(sessionId);
    else hideAndroidKeyboard();
    // Unmount (e.g. session disconnects while keyboard up) must dismiss too, else hide() never
    // runs and the WebView stays non-focusable app-wide (#34).
    return () => { hideAndroidKeyboard(); };
  }, [active, sessionId, isAndroid]);

  useEffect(() => { pasteOpen.current = paste !== null; }, [paste]);

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
      {paste && (
        <div
          data-mobile-term-toolbar
          className="absolute pointer-events-auto flex items-center gap-1 rounded-lg p-1"
          style={{
            left: `${Math.max(8, Math.min(paste.x, window.innerWidth - 160))}px`,
            top: `${Math.max(8, paste.y - 44)}px`,
            background: "var(--t-bg-modal)",
            border: "1px solid var(--t-border-hover)",
            boxShadow: "var(--t-elev-2)",
          }}
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
        >
          <button
            data-toolbar-paste
            className="vt-hit px-3 py-1.5 rounded-md text-xs font-medium text-(--t-text-primary)"
            onClick={() => {
              void readClipboard().then((text) => {
                if (text) getTerminalApi(sessionId)?.paste(text);
              });
              setPaste(null);
            }}
          >
            {t("mobile.terminalGestures.paste")}
          </button>
        </div>
      )}
    </div>
  );
}
