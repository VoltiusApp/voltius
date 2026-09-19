import { useCallback, useEffect, useRef, useState } from "react";

export function useHoverIntent({ openDelay, closeDelay, hold = false }: { openDelay: number; closeDelay: number; hold?: boolean }) {
  const [open, setOpenState] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const wasHeld = useRef(hold);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const setOpen = useCallback((value: boolean) => { clear(); setOpenState(value); }, []);
  const armClose = useCallback(() => { clear(); timer.current = setTimeout(() => setOpenState(false), closeDelay); }, [closeDelay]);
  const onMouseEnter = useCallback(() => { clear(); timer.current = setTimeout(() => setOpenState(true), openDelay); }, [openDelay]);
  const onMouseLeave = useCallback(() => {
    clear();
    if (!holdRef.current) armClose();
  }, [armClose]);

  // A real mouseleave already fired (and was skipped) before hold went true — nothing else will
  // re-arm the close timer, so releasing hold must settle the list itself, not wait for one.
  useEffect(() => {
    if (wasHeld.current && !hold) armClose();
    wasHeld.current = hold;
  }, [hold, armClose]);

  useEffect(() => clear, []);
  return { open, setOpen, bind: { onMouseEnter, onMouseLeave } };
}
