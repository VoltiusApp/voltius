import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useStatusBarMounted } from "@/stores/statusBarStore";
import { panelTransition } from "@/components/shared/panelMotion";
import { DragHandle } from "@/components/shared/DragHandle";
import { usePointerDrag } from "@/hooks/usePointerDrag";

const KEYBOARD_STEP = 16;
const MAX_VIEWPORT_SHARE = 0.5;

export interface SidePanelResize {
  min: number;
  max: number;
  defaultWidth: number;
  onChange: (cardWidth: number) => void;
  label: string;
}

interface SidePanelColumnProps {
  open: boolean;
  side: "left" | "right";
  columnWidth: number | string;
  cardWidth: string;
  resize?: SidePanelResize;
  testId?: string;
  children: ReactNode;
}

export function sidePanelWidthStyles(cardWidth: number, gutter: number) {
  const column = `min(${cardWidth + gutter}px, ${MAX_VIEWPORT_SHARE * 100}vw)`;
  return { columnWidth: column, cardWidth: `calc(${column} - ${gutter}px)` };
}

export function SidePanelColumn({ open, side, columnWidth, cardWidth, resize, testId, children }: SidePanelColumnProps) {
  const statusBarMounted = useStatusBarMounted();
  const columnRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const bottomInset = statusBarMounted ? "calc(24px + 0.5rem)" : "0.5rem";
  const width = typeof columnWidth === "number" ? `${columnWidth}px` : columnWidth;
  // Shifting by the full column width keeps the card riding the column's inner edge as it resizes.
  const closedShift = side === "right" ? width : `-${width}`;
  const { dragging, handlers } = useSidePanelDrag(side, resize, columnRef, cardRef);
  const cardStyle: CSSProperties = {
    width: cardWidth,
    bottom: bottomInset,
    transform: open ? undefined : `translateX(${closedShift})`,
    transition: panelTransition(open, "transform"),
  };

  return (
    <div
      ref={columnRef}
      data-testid={testId}
      className="relative shrink-0 overflow-hidden bg-(--t-bg-terminal)"
      style={{ width: open ? width : 0, transition: dragging ? "none" : panelTransition(open, "width") }}
    >
      <aside
        ref={cardRef}
        data-testid={testId ? `${testId}-card` : undefined}
        className={`flex flex-col absolute inset-y-2 ${side === "right" ? "right-2" : "left-2"} bg-(--t-bg-modal) border border-(--t-border) overflow-hidden rounded-[0.8rem]`}
        style={cardStyle}
        inert={!open}
        aria-hidden={!open}
      >
        {children}
      </aside>
      {resize && open && (
        <DragHandle
          axis="x"
          dragging={dragging}
          data-testid={testId ? `${testId}-resize` : undefined}
          aria-label={resize.label}
          title={resize.label}
          className={`absolute z-10 w-2.5 ${side === "right" ? "left-0" : "right-0"}`}
          style={{ top: "0.5rem", bottom: bottomInset }}
          onDoubleClick={() => resize.onChange(resize.defaultWidth)}
          {...handlers}
        />
      )}
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

function useSidePanelDrag(
  side: "left" | "right",
  resize: SidePanelResize | undefined,
  columnRef: RefObject<HTMLDivElement | null>,
  cardRef: RefObject<HTMLElement | null>,
) {
  const grow = side === "right" ? -1 : 1;

  const measure = () => {
    const column = columnRef.current?.getBoundingClientRect().width ?? 0;
    const card = cardRef.current?.getBoundingClientRect().width ?? 0;
    return { card, maxCard: window.innerWidth * MAX_VIEWPORT_SHARE - (column - card) };
  };

  const apply = (next: number, maxCard: number) => {
    if (!resize) return;
    resize.onChange(Math.round(Math.max(resize.min, Math.min(resize.max, maxCard, next))));
  };

  const { dragging, handlers } = usePointerDrag({
    cursor: "col-resize",
    begin: (e) => ({ x: e.clientX, ...measure() }),
    move: (e, start) => apply(start.card + grow * (e.clientX - start.x), start.maxCard),
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const direction = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    e.preventDefault();
    const { card, maxCard } = measure();
    apply(card + grow * direction * KEYBOARD_STEP, maxCard);
  };

  return { dragging, handlers: { ...handlers, onKeyDown } };
}
