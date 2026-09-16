import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const FADE_PX = 24;
const EDGE_PX = 48;
const MAX_AUTO_SCROLL_PX = 14;
const LINE_PX = 16;

type Overflow = { start: boolean; end: boolean };

export function wheelToHorizontal(e: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">, pageWidth: number): number {
  const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : 0;
  if (e.deltaMode === 1) return delta * LINE_PX;
  if (e.deltaMode === 2) return delta * pageWidth;
  return delta;
}

export function fadeMask({ start, end }: Overflow): CSSProperties | undefined {
  if (!start && !end) return undefined;
  const mask = `linear-gradient(to right, ${start ? "transparent" : "black"} 0, black ${FADE_PX}px, black calc(100% - ${FADE_PX}px), ${end ? "transparent" : "black"} 100%)`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

export function useTabStripScroll(activeKey: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>({ start: false, end: false });
  const autoScrollSpeed = useRef(0);
  const autoScrollFrame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      const dx = wheelToHorizontal(e, el.clientWidth);
      if (dx === 0) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", measure, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(el);
    const mutation = new MutationObserver(measure);
    mutation.observe(el, { childList: true, subtree: true });
    measure();
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", measure);
      resize?.disconnect();
      mutation.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const el = ref.current;
    const tab = el?.querySelector<HTMLElement>('[data-strip-active="true"]');
    if (!el || !tab) return;
    const strip = el.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < strip.left + FADE_PX) el.scrollLeft -= strip.left + FADE_PX - box.left;
    else if (box.right > strip.right - FADE_PX) el.scrollLeft += box.right - (strip.right - FADE_PX);
  }, [activeKey]);

  const stopAutoScroll = useCallback(() => {
    autoScrollSpeed.current = 0;
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = null;
  }, []);

  const autoScrollNear = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const { left, right } = el.getBoundingClientRect();
    const intoStart = EDGE_PX - (clientX - left);
    const intoEnd = EDGE_PX - (right - clientX);
    const depth = intoStart > 0 ? -intoStart : intoEnd > 0 ? intoEnd : 0;
    autoScrollSpeed.current = Math.round((Math.max(-EDGE_PX, Math.min(EDGE_PX, depth)) / EDGE_PX) * MAX_AUTO_SCROLL_PX);
    if (autoScrollSpeed.current === 0) return stopAutoScroll();
    if (autoScrollFrame.current !== null) return;
    const step = () => {
      if (!ref.current || autoScrollSpeed.current === 0) return stopAutoScroll();
      ref.current.scrollLeft += autoScrollSpeed.current;
      autoScrollFrame.current = requestAnimationFrame(step);
    };
    autoScrollFrame.current = requestAnimationFrame(step);
  }, [stopAutoScroll]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return { ref, overflow, autoScrollNear, stopAutoScroll };
}
