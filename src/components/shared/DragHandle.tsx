import type { HTMLAttributes } from "react";

interface DragHandleProps extends HTMLAttributes<HTMLDivElement> {
  axis: "x" | "y";
  dragging: boolean;
}

export function DragHandle({ axis, dragging, className, ...rest }: DragHandleProps) {
  const horizontal = axis === "x";
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      tabIndex={0}
      className={`group flex items-center justify-center focus:outline-hidden ${horizontal ? "cursor-col-resize" : "cursor-row-resize"} ${className ?? ""}`}
      {...rest}
    >
      <div
        className={`${horizontal ? "w-0.5 h-8" : "h-0.5 w-8"} rounded-full opacity-0 transition-[opacity,background-color] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${dragging ? "opacity-100" : ""}`}
        style={{ background: dragging ? "var(--t-accent)" : "color-mix(in srgb, var(--t-text-dim) 45%, transparent)" }}
      />
    </div>
  );
}
