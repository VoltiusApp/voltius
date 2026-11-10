import { useEffect, useRef, useState } from "react";
import type { TerminalSession } from "@/types";
import { closeWebPane, fetchWebFavicon, syncWebPane } from "@/services/webHost";
import { useSessionStore } from "@/stores/sessionStore";
import { notifyError } from "@/utils/notifyError";

/**
 * Whether a popover, menu or dialog is drawn over `el`. Those are portalled into `<body>`, so each
 * opening or closing adds or removes a direct child of it. The native page above would hide them,
 * so the caller hides the page meanwhile.
 */
function useCoveredByOverlay(el: React.RefObject<HTMLElement | null>, active: boolean): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!active) {
      setCovered(false);
      return;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      const node = el.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const home = node.closest("body > *");
      const hit = [0.2, 0.5, 0.8].some((fx) =>
        [0.2, 0.5, 0.8].some((fy) => {
          const top = document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy)[0];
          const owner = top?.closest("body > *");
          return !!owner && owner !== home;
        }),
      );
      setCovered(r.width > 0 && r.height > 0 && hit);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true });
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [el, active]);
  return covered;
}

/**
 * The page of a web host. The page is a native webview laid over this element rather than DOM, so
 * its position is pushed to the backend whenever the element moves or resizes, and it is hidden
 * (kept loaded) while the tab is not showing.
 *
 * Being native, the page sits above everything the app draws, so it is hidden while a popover or
 * modal is open over this area.
 */
export function WebPane({ session, visible: tabShown }: { session: TerminalSession; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const covered = useCoveredByOverlay(ref, tabShown);
  const visible = tabShown && !covered;
  const reported = useRef(false);
  const { id, webUrl } = session;

  useEffect(() => {
    const el = ref.current;
    if (!el || !webUrl) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      const shown = visible && r.width > 0 && r.height > 0;
      const bounds = shown ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      syncWebPane(id, webUrl, bounds).catch((err) => {
        // Resizing fires this many times; one toast is enough.
        if (reported.current) return;
        reported.current = true;
        notifyError(err);
      });
    };
    push();
    const observer = new ResizeObserver(push);
    observer.observe(el);
    window.addEventListener("resize", push);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", push);
    };
  }, [id, webUrl, visible]);

  // The tab shows the page's own icon; the globe stays when there is none.
  useEffect(() => {
    if (!webUrl) return;
    let cancelled = false;
    fetchWebFavicon(webUrl)
      .then((icon) => {
        if (icon && !cancelled) useSessionStore.getState().setWebIcon(id, icon);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, webUrl]);

  useEffect(() => () => void closeWebPane(id).catch(() => {}), [id]);

  return <div ref={ref} className="absolute inset-0 bg-(--t-bg-terminal)" />;
}
