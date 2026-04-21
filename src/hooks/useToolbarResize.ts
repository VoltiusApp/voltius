import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useToolbarResize() {
  const [compact, setCompact] = useState(false);

  const rowRef   = useRef<HTMLDivElement>(null);
  const leftRef  = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const naturalWidthRef = useRef(0);
  const compactRef      = useRef(false);

  useLayoutEffect(() => {
    if (leftRef.current && rightRef.current) {
      naturalWidthRef.current = leftRef.current.offsetWidth + rightRef.current.offsetWidth + 16;
    }
  }, []);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.width;

      if (!compactRef.current && (rightRef.current?.offsetWidth ?? 0) > 200) {
        naturalWidthRef.current =
          (leftRef.current?.offsetWidth ?? 0) + (rightRef.current?.offsetWidth ?? 0) + 16;
      }

      const natural = naturalWidthRef.current;
      if (natural === 0) return;

      const shouldCompact = available < natural;
      if (shouldCompact !== compactRef.current) {
        compactRef.current = shouldCompact;
        setCompact(shouldCompact);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { compact, rowRef, leftRef, rightRef };
}
