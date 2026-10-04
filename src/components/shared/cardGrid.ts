import type { CSSProperties } from "react";
import type { LayoutMode } from "@/components/shared/ToolbarViewControls";

export type CardSize = "compact" | "card" | "wide";

const MIN_WIDTH: Record<CardSize, string> = { compact: "11rem", card: "16rem", wide: "20rem" };

export function cardGridProps(layout: LayoutMode, size: CardSize, extraClass = ""): { className: string; style?: CSSProperties } {
  return layout === "grid"
    ? { className: `grid gap-4 ${extraClass}`.trim(), style: { gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_WIDTH[size]}, 1fr))` } }
    : { className: `flex flex-col gap-1 ${extraClass}`.trim() };
}
