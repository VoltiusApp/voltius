import { useEffect, useRef } from "react";
import type { TerminalSession } from "@/types";
import { closeWebPane, fetchWebFavicon, syncWebPane } from "@/services/webHost";
import { useSessionStore } from "@/stores/sessionStore";
import { notifyError } from "@/utils/notifyError";

/**
 * The page of a web host. The page is a native webview laid over this element rather than DOM, so
 * its position is pushed to the backend whenever the element moves or resizes, and it is hidden
 * (kept loaded) while the tab is not showing.
 *
 * Being native, the page sits above everything the app draws: a popover or modal opened over this
 * area is hidden behind it.
 */
export function WebPane({ session, visible }: { session: TerminalSession; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
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
