import { useEffect, useRef, useState } from "react";
import type { TerminalSession } from "@/types";
import { closeWebPane, fetchWebFavicon, syncWebPane } from "@/services/webHost";
import { useSessionStore } from "@/stores/sessionStore";
import { notifyError } from "@/utils/notifyError";

function isTextFieldFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type));
}

const MAX_NODES_SCANNED = 400;

/** Whether something that takes pointer events is drawn over `pane` inside an overlay of `<body>`. */
function overlayOver(pane: DOMRect, home: Element | null): boolean {
  const stack: Element[] = [];
  for (const child of document.body.children) {
    if (child !== home && !["SCRIPT", "STYLE", "LINK"].includes(child.tagName)) stack.push(child);
  }
  for (let scanned = 0; stack.length > 0 && scanned < MAX_NODES_SCANNED; scanned++) {
    const el = stack.pop() as Element;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (style.pointerEvents !== "none") {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left < pane.right && r.right > pane.left && r.top < pane.bottom && r.bottom > pane.top) {
        return true;
      }
    }
    stack.push(...el.children);
  }
  return false;
}

/**
 * Whether a popover, menu, dialog or toast is drawn over `el`. Those are portalled into `<body>`,
 * outside the app's root. The native page above would hide them, so the caller hides the page
 * meanwhile.
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
      setCovered(r.width > 0 && r.height > 0 && overlayOver(r, node.closest("body > *")));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    // Overlays come and go as body children, and change inside the ones that stay (a toast stack).
    // The app's own tree is not watched: a terminal repaints it constantly.
    const inner = new MutationObserver(schedule);
    const watchChildren = () => {
      const home = el.current?.closest("body > *");
      for (const child of document.body.children) {
        if (child !== home) inner.observe(child, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
      }
    };
    const outer = new MutationObserver(() => {
      watchChildren();
      schedule();
    });
    outer.observe(document.body, { childList: true });
    watchChildren();
    schedule();
    return () => {
      outer.disconnect();
      inner.disconnect();
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
  const wasShown = useRef(false);
  const { id, webUrl } = session;

  useEffect(() => {
    const el = ref.current;
    if (!el || !webUrl) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      const shown = visible && r.width > 0 && r.height > 0;
      const bounds = shown ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      // Showing the page takes the keyboard from the app: when it comes back into view while a
      // field has focus (a popover's search box), give the keyboard back.
      const refocusApp = shown && !wasShown.current && isTextFieldFocused();
      wasShown.current = shown;
      syncWebPane(id, webUrl, bounds, refocusApp).catch((err) => {
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
