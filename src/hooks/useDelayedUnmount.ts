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
