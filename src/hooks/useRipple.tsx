import { useState, useCallback } from "react";

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

  const createRipple = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const startTime = performance.now();
    const id = startTime + Math.random();

    setRipples((prev) => [
      ...prev,
      { id, x: e.clientX - rect.left - size / 2, y: e.clientY - rect.top - size / 2, size, startTime, phase: "entering" },
    ]);

    const fadeOut = () => {
      cleanup();
      setRipples((prev) => prev.map((r) => (r.id === id ? { ...r, phase: "exiting" } : r)));
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 500);
    };

    const onMouseUp = () => {
      const elapsed = performance.now() - startTime;
      const delay = Math.max(0, 350 - elapsed);
      setTimeout(fadeOut, delay);
    };

    const onMouseLeave = () => fadeOut();

    const cleanup = () => {
      document.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mouseleave", onMouseLeave);
    };

    document.addEventListener("mouseup", onMouseUp);
    el.addEventListener("mouseleave", onMouseLeave);
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
