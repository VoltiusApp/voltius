import type { CSSProperties, ReactNode } from "react";
import { useStatusBarMounted } from "@/stores/statusBarStore";
import { panelTransition } from "@/components/shared/panelMotion";

interface SidePanelColumnProps {
  open: boolean;
  side: "left" | "right";
  columnWidth: number | string;
  cardWidth: string;
  testId?: string;
  children: ReactNode;
}

export function SidePanelColumn({ open, side, columnWidth, cardWidth, testId, children }: SidePanelColumnProps) {
  const statusBarMounted = useStatusBarMounted();
  const bottomInset = statusBarMounted ? "calc(24px + 0.5rem)" : "0.5rem";
  const width = typeof columnWidth === "number" ? `${columnWidth}px` : columnWidth;
  // Shifting by the full column width keeps the card riding the column's inner edge as it resizes.
  const closedShift = side === "right" ? width : `-${width}`;
  const cardStyle: CSSProperties = {
    width: cardWidth,
    bottom: bottomInset,
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
      {statusBarMounted && (
        <div
          data-testid={testId ? `${testId}-status-filler` : undefined}
          className="absolute inset-x-0 bottom-0 border-t border-t-(--t-border)"
          style={{ height: 24, background: "var(--t-bg-status-bar)" }}
        />
      )}
    </div>
  );
}
