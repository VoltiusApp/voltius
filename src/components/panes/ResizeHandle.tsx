import { useLayoutStore, type SplitDirection } from "@/stores/layoutStore";
import { usePointerDrag } from "@/hooks/usePointerDrag";
import { DragHandle } from "@/components/shared/DragHandle";

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
  const horizontal = direction === "h";
  const { dragging, handlers } = usePointerDrag({
    cursor: horizontal ? "col-resize" : "row-resize",
    begin: () => null,
    move: (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = horizontal
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      setRatio(splitNodeId, ratio);
    },
  });

  return (
    <DragHandle
      axis={horizontal ? "x" : "y"}
      dragging={dragging}
      className={horizontal ? "w-2 -mx-0.5" : "h-2 -my-0.5"}
      {...handlers}
    />
  );
}
