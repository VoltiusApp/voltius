import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

type SelectionMode = "replace" | "add" | "toggle";

interface DragRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface DragBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface UseHostSelectionResult {
  selectedIdSet: Set<string>;
  selectionAreaRef: RefObject<HTMLDivElement | null>;
  hostAreaRef: RefObject<HTMLDivElement | null>;
  dragBox: DragBox | null;
  handleHostSelect: (id: string, event: ReactMouseEvent<HTMLDivElement>) => void;
  handleSelectionAreaMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  selectSingle: (id: string) => void;
}

export function useHostSelection(orderedHostIds: string[]): UseHostSelectionResult {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const selectionAreaRef = useRef<HTMLDivElement>(null);
  const hostAreaRef = useRef<HTMLDivElement>(null);
  const dragSelectionRef = useRef<{
    baseSelected: Set<string>;
    mode: SelectionMode;
  } | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);

  const orderedIdSet = useMemo(() => new Set(orderedHostIds), [orderedHostIds]);
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
    const fromIndex = orderedHostIds.indexOf(fromId);
    const toIndex = orderedHostIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return [toId];
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    return orderedHostIds.slice(start, end + 1);
  };

  const handleHostSelect = (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
    const isToggle = event.ctrlKey || event.metaKey;
    const isRange = event.shiftKey;

    if (isRange) {
      const anchor = selectionAnchorId ?? id;
      const rangeIds = getRangeIds(anchor, id);
      if (isToggle) {
        const next = new Set(selectedIds);
        rangeIds.forEach((rangeId) => next.add(rangeId));
        setSelectedIds(orderedHostIds.filter((x) => next.has(x)));
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
      setSelectedIds(orderedHostIds.filter((x) => next.has(x)));
      setSelectionAnchorId(id);
      return;
    }

    setSelectedIds([id]);
    setSelectionAnchorId(id);
  };

  const getIntersectedIdsFromRect = (startX: number, startY: number, endX: number, endY: number) => {
    const hostArea = hostAreaRef.current;
    if (!hostArea) return [] as string[];

    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);

    const selected: string[] = [];
    const cards = hostArea.querySelectorAll<HTMLElement>("[data-host-card='true'][data-connection-id]");
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const intersects = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
      if (intersects && card.dataset.connectionId) selected.push(card.dataset.connectionId);
    });

    return selected;
  };

  const updateSelectedFromRect = (startX: number, startY: number, endX: number, endY: number) => {
    const dragState = dragSelectionRef.current;
    if (!dragState) return;

    const hits = getIntersectedIdsFromRect(startX, startY, endX, endY);
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

    setSelectedIds(orderedHostIds.filter((id) => nextSet.has(id)));
  };

  const handleSelectionAreaMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='button']")) return;
    if (target.closest("[data-host-card='true']")) return;
    if (target.dataset.dragSurface !== "true") return;
    if (orderedHostIds.length === 0) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const hasToggleModifier = event.ctrlKey || event.metaKey;
    const hasAddModifier = event.shiftKey;
    const mode: SelectionMode = hasAddModifier
      ? "add"
      : hasToggleModifier
        ? "toggle"
        : "replace";
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

  const dragBox = useMemo(() => {
    if (!dragRect || !selectionAreaRef.current) return null;
    const selectionArea = selectionAreaRef.current;
    const bounds = selectionArea.getBoundingClientRect();

    const startX = dragRect.startX - bounds.left + selectionArea.scrollLeft;
    const startY = dragRect.startY - bounds.top + selectionArea.scrollTop;
    const endX = dragRect.endX - bounds.left + selectionArea.scrollLeft;
    const endY = dragRect.endY - bounds.top + selectionArea.scrollTop;

    return {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    };
  }, [dragRect]);

  const selectSingle = (id: string) => {
    setSelectedIds([id]);
    setSelectionAnchorId(id);
  };

  return {
    selectedIdSet,
    selectionAreaRef,
    hostAreaRef,
    dragBox,
    handleHostSelect,
    handleSelectionAreaMouseDown,
    selectSingle,
  };
}