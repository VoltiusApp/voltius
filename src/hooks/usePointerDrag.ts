import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type DragEvent = ReactPointerEvent<HTMLElement>;

interface PointerDragOptions<T> {
  cursor: string;
  begin: (e: DragEvent) => T;
  move: (e: DragEvent, origin: T) => void;
}

export function usePointerDrag<T>({ cursor, begin, move }: PointerDragOptions<T>) {
  const originRef = useRef<{ value: T } | null>(null);
  const [dragging, setDragging] = useState(false);

  const setBodyDragStyle = (active: boolean) => {
    document.body.style.cursor = active ? cursor : "";
    document.body.style.userSelect = active ? "none" : "";
  };

  const finish = (e: DragEvent) => {
    if (!originRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    originRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setBodyDragStyle(false);
  };

  const handlers = {
    onPointerDown: (e: DragEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      originRef.current = { value: begin(e) };
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setBodyDragStyle(true);
    },
    onPointerMove: (e: DragEvent) => {
      if (!originRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      move(e, originRef.current.value);
    },
    onPointerUp: finish,
    onPointerCancel: finish,
  };

  return { dragging, handlers };
}
