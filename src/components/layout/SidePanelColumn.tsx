import type { CSSProperties, ReactNode } from "react";
import { panelTransition } from "@/components/shared/panelMotion";

interface SidePanelColumnProps {
  open: boolean;
  side: "left" | "right";
  columnWidth: number | string;
  cardWidth: string;
  testId?: string;
  children: ReactNode;
}

/** Side panels run denser than the surrounding UI; zoom (not transform) so
 *  text and icons are laid out and rasterized at the larger size. */
const SIDE_PANEL_ZOOM = 1.05;

export function SidePanelColumn({ open, side, columnWidth, cardWidth, testId, children }: SidePanelColumnProps) {
  const baseWidth = typeof columnWidth === "number" ? `${columnWidth}px` : columnWidth;
  // The zoomed card is wider by the same factor, so the column must be too.
  const width = `calc(${baseWidth} * ${SIDE_PANEL_ZOOM})`;
  // Shifting by the full column width keeps the card riding the column's inner edge as it resizes.
  const closedShift = side === "right" ? width : `calc(-1 * ${width})`;
  const cardStyle: CSSProperties = {
    width: cardWidth,
    zoom: SIDE_PANEL_ZOOM,
    transform: open ? undefined : `translateX(${closedShift})`,
    transition: panelTransition(open, "transform"),
  };

  return (
    <div
      data-testid={testId}
      className="relative shrink-0 overflow-hidden bg-(--t-bg-terminal)"
      style={{ width: open ? width : 0, transition: panelTransition(open, "width") }}
    >
      <aside
        data-testid={testId ? `${testId}-card` : undefined}
        className={`flex flex-col absolute inset-y-2 ${side === "right" ? "right-2" : "left-2"} bg-(--t-bg-modal) border border-(--t-border) overflow-hidden rounded-[0.8rem]`}
        style={cardStyle}
        inert={!open}
        aria-hidden={!open}
      >
        {children}
      </aside>
    </div>
  );
}
