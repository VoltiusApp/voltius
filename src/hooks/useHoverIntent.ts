import { useCallback, useEffect, useRef, useState } from "react";

interface Point { x: number; y: number }

function containsPoint(el: HTMLElement | null, point: Point | null): boolean {
  if (!el || !point) return false;
  const r = el.getBoundingClientRect();
  return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
}

export function useHoverIntent({ openDelay, closeDelay, hold = false }: { openDelay: number; closeDelay: number; hold?: boolean }) {
  const [open, setOpenState] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const wasHeld = useRef(hold);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastPoint = useRef<Point | null>(null);

  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const setOpen = useCallback((value: boolean) => { clear(); setOpenState(value); }, []);
  const armClose = useCallback(() => { clear(); timer.current = setTimeout(() => setOpenState(false), closeDelay); }, [closeDelay]);
  const onMouseEnter = useCallback(() => { clear(); timer.current = setTimeout(() => setOpenState(true), openDelay); }, [openDelay]);
  const onMouseLeave = useCallback(() => {
    clear();
    if (!holdRef.current) armClose();
  }, [armClose]);

  useEffect(() => {
    if (!open) { lastPoint.current = null; return; }
    const onMove = (e: PointerEvent) => { lastPoint.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [open]);

  // A real mouseleave already fired (and was skipped) before hold went true, so releasing hold
  // must settle the list itself — but only when the pointer isn't resting on the pill or surface.
  useEffect(() => {
    if (wasHeld.current && !hold) {
      const resting = containsPoint(anchorRef.current, lastPoint.current) || containsPoint(surfaceRef.current, lastPoint.current);
      if (!resting) armClose();
    }
    wasHeld.current = hold;
  }, [hold, armClose]);

  useEffect(() => clear, []);
  return { open, setOpen, bind: { onMouseEnter, onMouseLeave }, anchorRef, surfaceRef };
}
