import { useCallback, useEffect, useRef, useState } from "react";

export function usePendingKills(onCommit: (id: string) => void, windowMs = 5000) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const clear = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setPending((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const start = useCallback((id: string) => {
    if (timers.current.has(id)) return;
    const t = setTimeout(() => {
      timers.current.delete(id);
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      commitRef.current(id);
    }, windowMs);
    timers.current.set(id, t);
    setPending((prev) => new Set(prev).add(id));
  }, [windowMs]);

  const cancel = useCallback((id: string) => clear(id), [clear]);

  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); map.clear(); };
  }, []);

  return { pending, start, cancel };
}
