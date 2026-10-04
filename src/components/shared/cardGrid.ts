import type { CSSProperties } from "react";
import type { LayoutMode } from "@/components/shared/ToolbarViewControls";

export function cardGridProps(layout: LayoutMode, minWidth: string, extraClass = ""): { className: string; style?: CSSProperties } {
  return layout === "grid"
    ? { className: `grid gap-4 ${extraClass}`.trim(), style: { gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))` } }
    : { className: `flex flex-col gap-1 ${extraClass}`.trim() };
}
