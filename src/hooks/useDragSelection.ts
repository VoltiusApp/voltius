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
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);

  const orderedIdSet = useMemo(() => new Set(orderedIds), [orderedIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = prev.filter((id) => orderedIdSet.has(id));
      return next.length === prev.length ? prev : next;
    });
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
    const startScrollTop = selectionAreaRef.current?.scrollTop ?? 0;
    const hasToggleModifier = event.ctrlKey || event.metaKey;
    const hasAddModifier = event.shiftKey;
    const mode: SelectionMode = hasAddModifier ? "add" : hasToggleModifier ? "toggle" : "replace";
    dragSelectionRef.current = { baseSelected: new Set(selectedIds), mode };
    if (mode === "replace") setSelectedIds([]);
    setDragRect({ startX, startY, endX: startX, endY: startY });

    // Adjusts startY in viewport-space to follow content as the list scrolls,
    // keeping the drag anchor pinned to the item it started on.
    const getAnchorY = () => startY - ((selectionAreaRef.current?.scrollTop ?? startScrollTop) - startScrollTop);

    let currentEndX = startX;
    let currentEndY = startY;

    const updateRect = (endX: number, endY: number) => {
      const anchorY = getAnchorY();
      setDragRect({ startX, startY: anchorY, endX, endY });
      updateSelectedFromRect(startX, anchorY, endX, endY);
    };

    // Scroll starts inside the container within SCROLL_ZONE px of the edge (speed = 0
    // at zone boundary, scaling up) and continues outside (no cap change).
    // Matches Windows Explorer: slow near edge, fast when dragged well past it.
    const SCROLL_ZONE = 60;
    const MAX_SCROLL_SPEED = 28;

    const tickAutoScroll = () => {
      const speed = autoScrollSpeedRef.current;
      if (speed === 0) { autoScrollRafRef.current = null; return; }
      const scrollArea = selectionAreaRef.current;
      if (scrollArea) {
        scrollArea.scrollTop += speed;
        updateRect(currentEndX, currentEndY);
      }
      autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
    };

    const onMouseMove = (ev: MouseEvent) => {
      currentEndX = ev.clientX;
      currentEndY = ev.clientY;
      updateRect(currentEndX, currentEndY);

      const itemArea = selectionAreaRef.current;
      if (itemArea) {
        const bounds = itemArea.getBoundingClientRect();
        // pull > 0 when cursor is within SCROLL_ZONE of edge (inside) or past it (outside)
        const topPull = bounds.top + SCROLL_ZONE - ev.clientY;
        const bottomPull = ev.clientY - (bounds.bottom - SCROLL_ZONE);
        let speed = 0;
        if (topPull > 0)
          speed = -Math.min(Math.ceil(topPull * 0.45), MAX_SCROLL_SPEED);
        else if (bottomPull > 0)
          speed = Math.min(Math.ceil(bottomPull * 0.45), MAX_SCROLL_SPEED);
        autoScrollSpeedRef.current = speed;
        if (speed !== 0 && autoScrollRafRef.current === null)
          autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
      }
    };

    const onScroll = () => updateRect(currentEndX, currentEndY);

    const onMouseUp = () => {
      setDragRect(null);
      dragSelectionRef.current = null;
      autoScrollSpeedRef.current = 0;
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      selectionAreaRef.current?.removeEventListener("scroll", onScroll);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    selectionAreaRef.current?.addEventListener("scroll", onScroll);
  };

  const dragBox = useMemo(() => {
    if (!dragRect) return null;
    const rawLeft   = Math.min(dragRect.startX, dragRect.endX);
    const rawTop    = Math.min(dragRect.startY, dragRect.endY);
    const rawRight  = Math.max(dragRect.startX, dragRect.endX);
    const rawBottom = Math.max(dragRect.startY, dragRect.endY);
    // Clamp visual box to the scroll container so it never renders outside it.
    const b = selectionAreaRef.current?.getBoundingClientRect();
    const left   = b ? Math.max(rawLeft,   b.left)   : rawLeft;
    const top    = b ? Math.max(rawTop,    b.top)    : rawTop;
    const right  = b ? Math.min(rawRight,  b.right)  : rawRight;
    const bottom = b ? Math.min(rawBottom, b.bottom) : rawBottom;
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
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
