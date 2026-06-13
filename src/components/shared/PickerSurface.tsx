import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BottomSheet from "@/components/mobile/sheets/BottomSheet";
import { useIsAndroid } from "@/utils/platform";

interface Pos { top?: number; bottom?: number; left: number; width: number; maxHeight: number }

/** A ref to any element used only for reading (positioning). `readonly current` makes it
 *  covariant, so a `RefObject<HTMLButtonElement | null>` etc. assigns without a cast. */
type AnchorRef = { readonly current: HTMLElement | null };

/** Responsive dropdown surface. Desktop: anchored floating portal positioned from
 *  `anchorRef` (with below/above flip). Mobile: a BottomSheet. Open state + the trigger
 *  stay owned by the caller; this owns only the open surface + its dismiss. */
export function PickerSurface({
  open, onClose, anchorRef, title, children, width,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: AnchorRef;
  title?: string;
  children: ReactNode;
  width?: number;
}) {
  const isAndroid = useIsAndroid();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos>({ left: 0, width: 0, maxHeight: 320 });

  // Desktop: measure the anchor on open, and keep the float pinned to it while open as the
  // form panel scrolls or the window resizes (the fixed-position float doesn't move on its own).
  useEffect(() => {
    if (!open || isAndroid) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = width ?? r.width;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const goUp = spaceBelow < 150 && spaceAbove > spaceBelow;
      setPos(goUp
        ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: w, maxHeight: Math.min(spaceAbove, 320) }
        : { top: r.bottom + 4, left: r.left, width: w, maxHeight: Math.min(spaceBelow, 320) });
    };
    measure();
    window.addEventListener("scroll", measure, true); // capture: catch scrolls in any ancestor
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, isAndroid, anchorRef, width]);

  // Desktop: outside-mousedown dismiss (ignores the anchor so the trigger toggles cleanly).
  useEffect(() => {
    if (!open || isAndroid) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !surfaceRef.current?.contains(t)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, isAndroid, anchorRef, onClose]);

  if (!open) return null;

  if (isAndroid) {
    return <BottomSheet title={title} onClose={onClose}>{children}</BottomSheet>;
  }

  return createPortal(
    <div
      ref={surfaceRef}
      className="surface-float fixed p-1.5 z-9999 flex flex-col overflow-y-auto"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
    >
      {children}
    </div>,
    document.body,
  );
}
