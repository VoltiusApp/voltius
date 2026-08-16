import { useState, useCallback, useEffect, useRef } from "react";

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
  startTime: number;
  phase: "entering" | "exiting";
}

export function useRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  // A press outlives the event that started it: two document listeners and up to
  // two timers, none of which the button's own unmount would take down.
  const pending = useRef(new Set<() => void>());

  useEffect(() => {
    const inFlight = pending.current;
    return () => {
      for (const release of [...inFlight]) release();
    };
  }, []);

  const createRipple = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    // Capture on the button: the press re-render detaches the icon node, and
    // WebKitGTK then drops the release.
    if (e.pointerId !== undefined) {
      try { el.setPointerCapture(e.pointerId); } catch { /* best-effort */ }
    }
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const startTime = performance.now();
    const id = startTime + Math.random();

    setRipples((prev) => [
      ...prev,
      { id, x: e.clientX - rect.left - size / 2, y: e.clientY - rect.top - size / 2, size, startTime, phase: "entering" },
    ]);

    const timers: ReturnType<typeof setTimeout>[] = [];

    const fadeOut = () => {
      detachListeners();
      setRipples((prev) => prev.map((r) => (r.id === id ? { ...r, phase: "exiting" } : r)));
      timers.push(setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
        release();
      }, 500));
    };

    const onPointerUp = () => {
      const elapsed = performance.now() - startTime;
      const delay = Math.max(0, 350 - elapsed);
      timers.push(setTimeout(fadeOut, delay));
    };

    const onPointerCancel = () => fadeOut();

    const detachListeners = () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    };

    const release = () => {
      detachListeners();
      for (const timer of timers) clearTimeout(timer);
      pending.current.delete(release);
    };

    pending.current.add(release);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
  }, []);

  const rippleEls = ripples.map((r) => {
    let animation: string;
    if (r.phase === "entering") {
      animation = "ripple-enter-anim 800ms cubic-bezier(0.4, 0, 0.2, 1) forwards";
    } else {
      // Negative delay resumes the scale animation from its current position
      const elapsed = Math.round(performance.now() - r.startTime);
      animation = `ripple-enter-anim 800ms cubic-bezier(0.4, 0, 0.2, 1) -${elapsed}ms forwards, ripple-exit-anim 500ms ease-out forwards`;
    }
    return (
      <span
        key={r.id}
        className="ripple"
        style={{ left: r.x, top: r.y, width: r.size, height: r.size, transform: "scale(0)", animation }}
      />
    );
  });

  return { createRipple, rippleEls };
}
