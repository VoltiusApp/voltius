import { useEffect, useRef, useState } from "react";
import type { TerminalSession } from "@/types";
import { fetchWebFavicon, syncWebPane } from "@/services/webHost";
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

/** Whether a portalled popover, menu, dialog or toast is drawn over `el`: the native page would hide it. */
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

/** A native webview kept over this element; hidden, not closed, while the tab is not shown. */
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
      // Showing the native page steals the keyboard from a focused app field (a popover's search box).
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

  useEffect(() => {
    if (!webUrl || useSessionStore.getState().sessions.find((s) => s.id === id)?.webIcon) return;
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

  // Unmounting is a move between tab and split: the page closes only with its session (sessionStore).
  useEffect(() => () => {
    if (webUrl) void syncWebPane(id, webUrl, null).catch(() => {});
  }, [id, webUrl]);

  return <div ref={ref} className="absolute inset-0 bg-(--t-bg-terminal)" />;
}
