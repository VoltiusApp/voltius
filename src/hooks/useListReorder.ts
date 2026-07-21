import { useRef, useState } from "react";
import { reorder } from "@/utils/reorderList";

/** Mouse-drag reorder for an id-keyed list. Extracted from JumpHostsPanel so the
 *  same interaction (grip handle + before/after drop indicator) is reused by the
 *  snippet step list. Wire containerProps to the scroll container, handleProps to
 *  the grip, rowProps to each row, and rowState to each row's style. */
export function useListReorder<T extends { id: string }>(
  items: T[],
  onChange: (next: T[]) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<"before" | "after">("after");
  const dragRef = useRef<string | null>(null);

  const cancel = () => {
    dragRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  const drop = () => {
    const fromId = dragRef.current;
    if (!fromId || !dragOverId || fromId === dragOverId) return cancel();
    onChange(reorder(items, fromId, dragOverId, dragOverPos));
    cancel();
  };

  return {
    dragging: draggingId !== null,
    containerProps: { onMouseUp: drop, onMouseLeave: cancel },
    handleProps: (id: string) => ({
      onMouseDown: () => { dragRef.current = id; setDraggingId(id); },
    }),
    rowProps: (id: string) => ({
      onMouseMove: (e: React.MouseEvent<HTMLElement>) => {
        if (!dragRef.current || dragRef.current === id) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setDragOverId(id);
        setDragOverPos(e.clientY < rect.top + rect.height / 2 ? "before" : "after");
      },
    }),
    rowState: (id: string) => ({
      isDragging: draggingId === id,
      isOver: dragOverId === id && draggingId !== id,
      pos: dragOverPos,
    }),
  };
}
