import { useRef, useState } from "react";
import { useLayoutStore, type SplitDirection } from "@/stores/layoutStore";

export function ResizeHandle({
  splitNodeId,
  direction,
  containerRef,
}: {
  splitNodeId: string;
  direction: SplitDirection;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const setRatio = useLayoutStore((s) => s.setRatio);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    setIsDragging(true);

    const onMove = (move: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = direction === "h"
        ? (move.clientX - rect.left) / rect.width
        : (move.clientY - rect.top) / rect.height;
      setRatio(splitNodeId, ratio);
    };

    const onUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={direction === "h" ? "vertical" : "horizontal"}
      tabIndex={0}
      className={direction === "h"
        ? "group w-2 -mx-0.5 cursor-col-resize flex items-center justify-center focus:outline-hidden"
        : "group h-2 -my-0.5 cursor-row-resize flex items-center justify-center focus:outline-hidden"}
    >
      <div
        className={`${direction === "h" ? "w-0.5 h-8" : "h-0.5 w-8"} rounded-full opacity-0 transition-[opacity,background-color] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${isDragging ? "opacity-100" : ""}`}
        style={{ background: isDragging ? "var(--t-accent)" : "color-mix(in srgb, var(--t-text-dim) 45%, transparent)" }}
      />
    </div>
  );
}
