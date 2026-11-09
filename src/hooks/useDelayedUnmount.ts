import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

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

// Inline durations, not Tailwind utilities: they must beat the `animation` shorthand baked into animate-fade*.
const FADE_IN = { className: "animate-fadeIn", style: { animationDuration: "140ms" } } as const;
const FADE_OUT = { className: "animate-fadeOut pointer-events-none", style: { animationDuration: "110ms" } } as const;

export function usePopoverFade(open: boolean) {
  const mounted = useDelayedUnmount(open, POPOVER_EXIT_MS);
  return { mounted, ...(open ? FADE_IN : FADE_OUT) };
}

function fadeOutCopy(el: HTMLElement) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.classList.remove(FADE_IN.className);
  copy.classList.add(...FADE_OUT.className.split(" "));
  Object.assign(copy.style, FADE_OUT.style);
  copy.removeAttribute("data-menu-portal");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  document.body.appendChild(copy);
  const animations = copy.getAnimations?.() ?? [];
  if (animations.length === 0) return copy.remove();
  void Promise.allSettled(animations.map((a) => a.finished)).then(() => copy.remove());
}

/**
 * Popover fade for a fixed-position portal its caller unmounts outright (`{pos && <Menu/>}`):
 * fades in on mount, and fades a detached copy out on unmount.
 */
export function useMountFade(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Checked after commit: StrictMode's simulated unmount leaves the node attached.
    return () => queueMicrotask(() => { if (!el.isConnected) fadeOutCopy(el); });
  }, [ref]);
  return FADE_IN;
}
