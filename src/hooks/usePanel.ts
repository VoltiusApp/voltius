import { useState, useRef, useCallback } from "react";

/**
 * Arc-style panel behavior: collapsed (sliver) → hover expand → pinned.
 * Pinned state is owned externally (uiStore, persisted).
 * Hover state is local and ephemeral.
 */
export function usePanel(pinned: boolean, setPinned: (v: boolean) => void) {
  const [hovering, setHovering] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onSliverEnter = useCallback(() => {
    clearTimeout(hoverTimer.current);
    if (!pinned) setHovering(true);
  }, [pinned]);

  const onPanelLeave = useCallback(() => {
    hoverTimer.current = setTimeout(() => {
      setHovering(false);
    }, 150);
  }, []);

  const onPanelEnter = useCallback(() => {
    clearTimeout(hoverTimer.current);
  }, []);

  const toggle = useCallback(() => {
    setPinned(!pinned);
    setHovering(false);
  }, [pinned, setPinned]);

  const isOpen = pinned || hovering;

  return { isOpen, isPinned: pinned, hovering, toggle, onSliverEnter, onPanelLeave, onPanelEnter };
}
