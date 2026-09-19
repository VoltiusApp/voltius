import { useCallback, useEffect, useRef, useState } from "react";

export function useHoverIntent({ openDelay, closeDelay, hold = false }: { openDelay: number; closeDelay: number; hold?: boolean }) {
  const [open, setOpenState] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const setOpen = useCallback((value: boolean) => { clear(); setOpenState(value); }, []);
  const onMouseEnter = useCallback(() => { clear(); timer.current = setTimeout(() => setOpenState(true), openDelay); }, [openDelay]);
  const onMouseLeave = useCallback(() => {
    clear();
    if (holdRef.current) return;
    timer.current = setTimeout(() => setOpenState(false), closeDelay);
  }, [closeDelay]);
  useEffect(() => clear, []);
  return { open, setOpen, bind: { onMouseEnter, onMouseLeave } };
}
