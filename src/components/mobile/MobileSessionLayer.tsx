import { useLayoutEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { animate, SESSION_MOTION } from "@/lib/motion";
import MobileSessionView from "./MobileSessionView";
import { switchDirection } from "./sessionSwipeCore";
import { useMobileSessions } from "./useMobileSessions";

/** Always mounted in MobileShell; `visible` only toggles visibility so xterm state survives. */
export default function MobileSessionLayer({ visible }: { visible: boolean }) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useMobileSessions();
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const prevActive = useRef(activeSessionId);
  const running = useRef<(() => void) | null>(null);

  // Shared axis X between sibling sessions (chip tap, swipe, new session): the leaving one stays
  // visible just long enough to slide/fade out, the arriving one slides in from its side.
  useLayoutEffect(() => {
    const from = prevActive.current;
    prevActive.current = activeSessionId;
    if (!visible || from === activeSessionId) return;
    const dir = switchDirection(sessions.map((s) => s.id), from, activeSessionId);
    const inEl = activeSessionId ? wrappers.current.get(activeSessionId) : undefined;
    const outEl = from ? wrappers.current.get(from) : undefined;
    if (!dir || !inEl || !outEl || typeof inEl.animate !== "function") return;
    running.current?.();
    const shift = SESSION_MOTION.shiftPx * dir;
    outEl.style.visibility = "visible";
    outEl.dataset.mobileSessionLeaving = "";
    const out = animate(outEl, [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: `translateX(${-shift}px)` },
    ], SESSION_MOTION.exit.duration, SESSION_MOTION.exit.easing, { fill: "forwards" });
    const enter = animate(inEl, [
      { opacity: 0, transform: `translateX(${shift}px)` },
      { opacity: 1, transform: "none" },
    ], SESSION_MOTION.enter.duration, SESSION_MOTION.enter.easing);
    // Idempotent: hide the leaving session again and drop its held end frame.
    const settleOut = () => {
      outEl.style.visibility = "";
      delete outEl.dataset.mobileSessionLeaving;
      out.cancel();
    };
    out.finished.then(settleOut, () => {});
    running.current = () => { settleOut(); enter.cancel(); };
    // `sessions` is derived from the store each render; the switch itself is keyed on the ids.
  }, [activeSessionId, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      data-mobile-session-layer
      className={`absolute inset-0 ${visible ? "" : "invisible pointer-events-none"}`}
      style={{ overflow: "clip", overscrollBehavior: "contain" }}
    >
      {sessions.map((session) => (
        <div
          key={session.id}
          data-mobile-session={session.id}
          data-active={session.id === activeSessionId ? "" : undefined}
          ref={(el) => { if (el) wrappers.current.set(session.id, el); else wrappers.current.delete(session.id); }}
          className={`absolute inset-0 ${session.id === activeSessionId ? "z-10" : "z-0 invisible pointer-events-none"}`}
        >
          <MobileSessionView
            session={session}
            active={visible && session.id === activeSessionId && session.status === "connected"}
          />
        </div>
      ))}
    </div>
  );
}
