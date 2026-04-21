import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

type SelectionMode = "replace" | "add" | "toggle";

interface DragRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface DragBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface UseDragSelectionResult {
  selectedIdSet: Set<string>;
  selectionAreaRef: RefObject<HTMLDivElement | null>;
  itemAreaRef: RefObject<HTMLDivElement | null>;
  dragBox: DragBox | null;
  handleItemSelect: (id: string, event: ReactMouseEvent<HTMLDivElement>) => void;
  handleSelectionAreaMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  selectSingle: (id: string) => void;
  setSelection: (ids: string[]) => void;
}

export function useDragSelection(orderedIds: string[]): UseDragSelectionResult {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const selectionAreaRef = useRef<HTMLDivElement>(null);
  const itemAreaRef = useRef<HTMLDivElement>(null);
  const dragSelectionRef = useRef<{
    baseSelected: Set<string>;
    mode: SelectionMode;
  } | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);

  const orderedIdSet = useMemo(() => new Set(orderedIds), [orderedIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => orderedIdSet.has(id)));
  }, [orderedIdSet]);

  useEffect(() => {
    if (selectionAnchorId && !orderedIdSet.has(selectionAnchorId)) {
      setSelectionAnchorId(null);
    }
  }, [orderedIdSet, selectionAnchorId]);

  const getRangeIds = (fromId: string, toId: string) => {
    const fromIndex = orderedIds.indexOf(fromId);
    const toIndex = orderedIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return [toId];
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    return orderedIds.slice(start, end + 1);
  };

  const handleItemSelect = (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
    const isToggle = event.ctrlKey || event.metaKey;
    const isRange = event.shiftKey;

    if (isRange) {
      const anchor = selectionAnchorId ?? id;
      const rangeIds = getRangeIds(anchor, id);
      if (isToggle) {
        const next = new Set(selectedIds);
        rangeIds.forEach((rangeId) => next.add(rangeId));
        setSelectedIds(orderedIds.filter((x) => next.has(x)));
      } else {
        setSelectedIds(rangeIds);
      }
      setSelectionAnchorId(id);
      return;
    }

    if (isToggle) {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(orderedIds.filter((x) => next.has(x)));
      setSelectionAnchorId(id);
      return;
    }

    setSelectedIds([id]);
    setSelectionAnchorId(id);
  };

  const getIntersectedIds = (startX: number, startY: number, endX: number, endY: number) => {
    const itemArea = itemAreaRef.current;
    if (!itemArea) return [] as string[];

    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);

    const selected: string[] = [];
    const cards = itemArea.querySelectorAll<HTMLElement>("[data-selectable-id]");
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const intersects = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
      if (intersects && card.dataset.selectableId) selected.push(card.dataset.selectableId);
    });

    return selected;
  };

  const updateSelectedFromRect = (startX: number, startY: number, endX: number, endY: number) => {
    const dragState = dragSelectionRef.current;
    if (!dragState) return;

    const hits = getIntersectedIds(startX, startY, endX, endY);
    const nextSet = new Set(dragState.baseSelected);

    if (dragState.mode === "replace") {
      setSelectedIds(hits);
      return;
    }

    if (dragState.mode === "add") {
      hits.forEach((id) => nextSet.add(id));
    } else {
      hits.forEach((id) => {
        if (nextSet.has(id)) nextSet.delete(id);
        else nextSet.add(id);
      });
    }

    setSelectedIds(orderedIds.filter((id) => nextSet.has(id)));
  };

  const handleSelectionAreaMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='button']")) return;
    if (target.closest("[data-selectable-id]")) return;
    if (!target.closest("[data-drag-surface='true']")) return;
    if (orderedIds.length === 0) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const hasToggleModifier = event.ctrlKey || event.metaKey;
    const hasAddModifier = event.shiftKey;
    const mode: SelectionMode = hasAddModifier ? "add" : hasToggleModifier ? "toggle" : "replace";
    dragSelectionRef.current = { baseSelected: new Set(selectedIds), mode };
    if (mode === "replace") setSelectedIds([]);
    setDragRect({ startX, startY, endX: startX, endY: startY });

    const onMouseMove = (ev: MouseEvent) => {
      setDragRect({ startX, startY, endX: ev.clientX, endY: ev.clientY });
      updateSelectedFromRect(startX, startY, ev.clientX, ev.clientY);
    };

    const onMouseUp = () => {
      setDragRect(null);
      dragSelectionRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Drag box in viewport coordinates (used with position:fixed rendering).
  // The hit-test already uses clientX/clientY + getBoundingClientRect(), so no
  // scroll offset is needed here either.
  const dragBox = useMemo(() => {
    if (!dragRect) return null;
    return {
      left: Math.min(dragRect.startX, dragRect.endX),
      top: Math.min(dragRect.startY, dragRect.endY),
      width: Math.abs(dragRect.endX - dragRect.startX),
      height: Math.abs(dragRect.endY - dragRect.startY),
    };
  }, [dragRect]);

  const selectSingle = (id: string) => {
    setSelectedIds([id]);
    setSelectionAnchorId(id);
  };

  const setSelection = (ids: string[]) => {
    setSelectedIds(ids.filter((id) => orderedIdSet.has(id)));
    setSelectionAnchorId(ids.length > 0 ? ids[ids.length - 1] : null);
  };

  return {
    selectedIdSet,
    selectionAreaRef,
    itemAreaRef,
    dragBox,
    handleItemSelect,
    handleSelectionAreaMouseDown,
    selectSingle,
    setSelection,
  };
}
