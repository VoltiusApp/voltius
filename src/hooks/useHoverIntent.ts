import { useCallback, useEffect, useRef, useState } from "react";

export function useHoverIntent({ openDelay, closeDelay }: { openDelay: number; closeDelay: number }) {
  const [open, setOpenState] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const setOpen = useCallback((value: boolean) => { clear(); setOpenState(value); }, []);
  const onMouseEnter = useCallback(() => { clear(); timer.current = setTimeout(() => setOpenState(true), openDelay); }, [openDelay]);
  const onMouseLeave = useCallback(() => { clear(); timer.current = setTimeout(() => setOpenState(false), closeDelay); }, [closeDelay]);
  useEffect(() => clear, []);
  return { open, setOpen, bind: { onMouseEnter, onMouseLeave } };
}
