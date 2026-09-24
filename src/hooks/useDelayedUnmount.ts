import { useEffect, useState } from "react";

/**
 * Keeps a portal mounted for the length of its exit animation. `if (!open) return null`
 * cannot animate out — the node is gone before a transition can run.
 */
export function useDelayedUnmount(open: boolean, ms: number): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, ms]);
  return mounted;
}

const POPOVER_EXIT_MS = 140;

export function usePopoverFade(open: boolean) {
  const mounted = useDelayedUnmount(open, POPOVER_EXIT_MS);
  return {
    mounted,
    className: open ? "animate-fadeIn" : "animate-fadeOut",
    // Inline, not a Tailwind duration utility: it must beat the `animation` shorthand baked into animate-fade*.
    style: { animationDuration: open ? "140ms" : "110ms" },
  };
}
