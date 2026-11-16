import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { FAB_SCROLL_THRESHOLD, fabExtended, foldProgress } from "./collapsingHeaderCore";

/** For a pushed page with no large title: only the FAB and the scrolled app bar follow the scroll. */
export const NO_LARGE_TITLE: RefObject<HTMLElement | null> = { current: null };

/**
 * Scroll-linked large title + extended FAB for an Android root list. Attach `onScroll`
 * to the scroller. Once per frame it only writes `--vt-fold` (0–1) and `data-folded` /
 * `data-scrolled` on `root` (CSS does the rest, no React render); React state changes
 * only when the FAB flips between extended and collapsed.
 */
export function useCollapsingHeader(root: RefObject<HTMLElement | null>, largeTitle: RefObject<HTMLElement | null>) {
  const [extended, setExtended] = useState(true);
  const frame = useRef(0);
  const anchor = useRef(0);
  const ext = useRef(true);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const onScroll = useCallback((e: { currentTarget: HTMLElement }) => {
    const scroller = e.currentTarget;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const top = scroller.scrollTop;
      const p = foldProgress(top, largeTitle.current?.offsetHeight ?? 0);
      const el = root.current;
      if (el) {
        el.style.setProperty("--vt-fold", p.toFixed(3));
        el.dataset.folded = String(p > 0.5);
        el.dataset.scrolled = String(p >= 1);
      }
      const dy = top - anchor.current;
      const next = fabExtended(ext.current, top, dy);
      if (Math.abs(dy) > FAB_SCROLL_THRESHOLD || top <= 0) anchor.current = top;
      if (next !== ext.current) { ext.current = next; setExtended(next); }
    });
  }, [root, largeTitle]);
  return { onScroll, fabExtended: extended };
}
