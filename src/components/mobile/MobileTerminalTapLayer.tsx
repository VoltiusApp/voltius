import { useEffect, useRef, useState } from "react";
import { sendSpecialKey } from "@/services/terminalInput";
import { isDoubleTap, type TapPoint } from "./doubleTap";

const DOUBLE_TAP = { ms: 300, px: 24 };

/**
 * Mobile-only: double-tap anywhere on the active terminal sends Tab and flashes a
 * centered "Tab" hint. A capture-phase touchend listener on the terminal container
 * observes taps without swallowing them — only the second tap of a recognized
 * double-tap is consumed (preventDefault + stopPropagation) so xterm's synthesized
 * double-click word-select never fires. Single taps and drags pass through.
 */
export default function MobileTerminalTapLayer({ sessionId, active }: { sessionId: string; active: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastTap = useRef<TapPoint | null>(null);
  const [hintKey, setHintKey] = useState(0);

  useEffect(() => {
    if (!active) return;
    const container = rootRef.current?.parentElement;
    if (!container) return;

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const now: TapPoint = { t: e.timeStamp, x: touch.clientX, y: touch.clientY };
      const prev = lastTap.current;
      if (prev && isDoubleTap(prev, now, DOUBLE_TAP)) {
        e.preventDefault();
        e.stopPropagation();
        lastTap.current = null; // start a fresh pair (a triple-tap isn't two double-taps)
        sendSpecialKey(sessionId, "Tab", { ctrl: false, alt: false });
        setHintKey((k) => k + 1);
        return;
      }
      lastTap.current = now;
    };

    container.addEventListener("touchend", onTouchEnd, { capture: true });
    return () => container.removeEventListener("touchend", onTouchEnd, { capture: true } as EventListenerOptions);
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
