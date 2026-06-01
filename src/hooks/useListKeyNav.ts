import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useUIStore } from "@/stores/uiStore";

export interface UseListKeyNavOptions {
  orderedIds: string[];
  selectedIdSet: Set<string>;
  selectSingle: (id: string) => void;
  setSelection: (ids: string[]) => void;
  itemAreaRef: RefObject<HTMLDivElement | null>;
  layoutMode?: "grid" | "list";
  /** Whether this page/list is currently mounted and visible */
  isActive?: boolean;
  onEnter?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onEscape?: () => void;
  onSearch?: () => void;
  onBackspace?: () => void;
  extraKeys?: Record<string, (id: string) => void>;
}

export interface UseListKeyNavResult {
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
}

export function useListKeyNav({
  orderedIds,
  selectedIdSet,
  selectSingle,
  setSelection,
  itemAreaRef,
  layoutMode = "list",
  isActive = true,
  onEnter,
  onEdit,
  onDuplicate,
  onEscape,
  onSearch,
  onBackspace,
  extraKeys,
}: UseListKeyNavOptions): UseListKeyNavResult {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const anchorIdRef = useRef<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;

  // Sync focusedId when user clicks a single item, clear when deselected
  useEffect(() => {
    if (selectedIdSet.size === 0) {
      setFocusedId(null);
      anchorIdRef.current = null;
    } else if (selectedIdSet.size === 1) {
      const [id] = selectedIdSet;
      if (focusedIdRef.current !== id) {
        setFocusedId(id);
        anchorIdRef.current = id;
      }
    }
  }, [selectedIdSet]);

  // Prune focusedId when item leaves orderedIds (filter change, folder nav)
  useEffect(() => {
    if (focusedId !== null && !orderedIds.includes(focusedId)) {
      setFocusedId(null);
      anchorIdRef.current = null;
    }
  }, [orderedIds, focusedId]);

  // Measure grid column count from DOM at event time
  const getColumnCount = useCallback((): number => {
    const cards = [
      ...(itemAreaRef.current?.querySelectorAll<HTMLElement>("[data-selectable-id]") ?? []),
    ];
    if (cards.length < 2) return 1;
    const firstY = cards[0].getBoundingClientRect().top;
    return cards.filter((c) => Math.abs(c.getBoundingClientRect().top - firstY) < 4).length;
  }, [itemAreaRef]);

  const scrollIntoView = useCallback((id: string) => {
    const el = itemAreaRef.current?.querySelector<HTMLElement>(
      `[data-selectable-id="${CSS.escape(id)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [itemAreaRef]);

  // Check if keyboard input should be blocked
  const isBlocked = useCallback((e: KeyboardEvent): boolean => {
    const { omniOpen, settingsOpen, importExportModal } = useUIStore.getState();
    if (omniOpen || settingsOpen || importExportModal?.open) return true;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable]")) return true;
    if (document.querySelector("[role='dialog']")) return true;
    return false;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      if (isBlocked(e)) return;

      const ids = orderedIds;
      const currentFocused = focusedIdRef.current;
      const currentIndex = currentFocused != null ? ids.indexOf(currentFocused) : -1;

      // ── Arrow / Home / End ────────────────────────────────────────────────
      const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      const isHomeEnd = e.key === "Home" || e.key === "End";

      if (isArrow || isHomeEnd) {
        if (ids.length === 0) return;
        e.preventDefault();

        const cols = layoutMode === "grid" ? getColumnCount() : 1;
        let delta = 0;
        if (e.key === "ArrowUp")    delta = -cols;
        if (e.key === "ArrowDown")  delta =  cols;
        if (e.key === "ArrowLeft")  delta = layoutMode === "grid" ? -1 : 0;
        if (e.key === "ArrowRight") delta = layoutMode === "grid" ?  1 : 0;

        let nextIndex: number;
        if (e.key === "Home") {
          nextIndex = 0;
        } else if (e.key === "End") {
          nextIndex = ids.length - 1;
        } else if (currentIndex < 0) {
          nextIndex = delta >= 0 ? 0 : ids.length - 1;
        } else {
          nextIndex = Math.max(0, Math.min(ids.length - 1, currentIndex + delta));
        }

        const nextId = ids[nextIndex];
        if (!nextId) return;

        if (e.shiftKey) {
          const anchor = anchorIdRef.current ?? nextId;
          const anchorIndex = ids.indexOf(anchor);
          if (anchorIndex < 0) {
            selectSingle(nextId);
            anchorIdRef.current = nextId;
          } else {
            const start = Math.min(anchorIndex, nextIndex);
            const end = Math.max(anchorIndex, nextIndex);
            setSelection(ids.slice(start, end + 1));
            // anchor stays fixed during shift-extend
          }
        } else {
          selectSingle(nextId);
          anchorIdRef.current = nextId;
        }

        setFocusedId(nextId);
        scrollIntoView(nextId);
        return;
      }

      // ── Page-level keys (no focused item needed) ──────────────────────────
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape?.();
        return;
      }

      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onSearch?.();
        return;
      }

      if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onBackspace?.();
        return;
      }

      // ── Item-action keys (require a focused/selected item) ────────────────
      const focused = currentFocused ?? (selectedIdSet.size === 1 ? [...selectedIdSet][0] : null);
      if (!focused) return;

      if (e.key === "Enter") {
        e.preventDefault();
        onEnter?.(focused);
        return;
      }

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        onEdit?.(focused);
        return;
      }

      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        onDuplicate?.(focused);
        return;
      }

      if (extraKeys) {
        const handler = extraKeys[e.key];
        if (handler) {
          e.preventDefault();
          handler(focused);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isActive,
    orderedIds,
    selectedIdSet,
    layoutMode,
    isBlocked,
    getColumnCount,
    scrollIntoView,
    selectSingle,
    setSelection,
    onEnter,
    onEdit,
    onDuplicate,
    onEscape,
    onSearch,
    onBackspace,
    extraKeys,
  ]);

  return { focusedId, setFocusedId };
}
