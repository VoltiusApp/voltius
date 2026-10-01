import { useEffect, useRef } from "react";
import { usePopoverFade } from "./useDelayedUnmount";

type AnchorRef = { readonly current: HTMLElement | null };

function isTextField(el: HTMLElement) {
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

export function useAnchoredPopover(
  open: boolean,
  onClose: () => void,
  anchorRef: AnchorRef,
) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const owns = (target: Node) => !!(anchorRef.current?.contains(target) || panelRef.current?.contains(target));
    // The anchor is excluded so its onClick toggle is the only thing that closes on it.
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (owns(target) || (target as Element).closest?.("[data-menu-portal]")) return;
      onCloseRef.current();
    };
    // Capture phase: the open popover claims Escape before a modal or page behind it does.
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (e.key !== "Escape" || (target instanceof HTMLElement && owns(target) && isTextField(target))) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, anchorRef]);

  return { panelRef, ...usePopoverFade(open) };
}
