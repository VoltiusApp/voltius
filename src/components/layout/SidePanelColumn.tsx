import type { CSSProperties, ReactNode } from "react";
import { useStatusBarMounted } from "@/stores/statusBarStore";

const TRANSITION = "width 180ms cubic-bezier(0.4, 0, 0.2, 1)";

interface SidePanelColumnProps {
  open: boolean;
  columnWidth: number | string;
  cardEdgeClassName: string;
  cardStyle?: CSSProperties;
  testId?: string;
  children: ReactNode;
}

export function SidePanelColumn({ open, columnWidth, cardEdgeClassName, cardStyle, testId, children }: SidePanelColumnProps) {
  const statusBarMounted = useStatusBarMounted();
  const bottomInset = statusBarMounted ? "calc(24px + 0.5rem)" : "0.5rem";

  return (
    <div
      data-testid={testId}
      className="relative shrink-0 overflow-hidden bg-(--t-bg-terminal)"
      style={{ width: open ? columnWidth : 0, transition: TRANSITION }}
    >
      <aside
        data-testid={testId ? `${testId}-card` : undefined}
        className={`flex flex-col absolute inset-y-2 ${cardEdgeClassName} bg-(--t-bg-modal) border border-(--t-border) overflow-hidden rounded-[0.8rem]`}
        style={{ ...cardStyle, bottom: bottomInset }}
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
