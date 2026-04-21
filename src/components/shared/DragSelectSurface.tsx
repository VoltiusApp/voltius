import { createPortal } from "react-dom";
import type { RefObject } from "react";
import type { DragBox } from "@/hooks/useDragSelection";

interface Props {
  selectionAreaRef: RefObject<HTMLDivElement | null>;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  dragBox: DragBox | null;
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function DragSelectSurface({ selectionAreaRef, onMouseDown, dragBox, children, className = "", onClick, onContextMenu }: Props) {
  return (
    <div
      ref={selectionAreaRef}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-drag-surface="true"
      className={`relative select-none ${className}`}
    >
      {children}
      {dragBox && dragBox.width > 0 && dragBox.height > 0 && createPortal(
        <div
          className="pointer-events-none fixed z-20 border border-[var(--t-tab-active-text)]"
          style={{
            left: dragBox.left,
            top: dragBox.top,
            width: dragBox.width,
            height: dragBox.height,
            background: "color-mix(in srgb, var(--t-tab-active-text) 18%, transparent)",
          }}
        />,
        document.body,
      )}
    </div>
  );
}
