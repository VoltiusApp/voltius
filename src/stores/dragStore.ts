import { create } from "zustand";
import type { SplitPosition } from "@/stores/layoutStore";

export type DragType = "tab" | "pane";

type DropTarget =
  | { type: "pane"; paneId: string; position: SplitPosition }
  | { type: "session"; sessionId: string; position: SplitPosition }
  | { type: "titlebar"; targetKey?: string | null; placement?: "before" | "after" };

interface DragStore {
  isPointerDown: boolean;
  isDragging: boolean;
  dragType: DragType | null;
  sessionId: string | null;
  sourcePaneId: string | null;
  sourceTitlebarKey: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  dropTarget: DropTarget | null;
  lastDragEndedAt: number;

  beginTabDrag(sessionId: string, x: number, y: number, titlebarKey?: string): void;
  beginSplitTabDrag(tabId: string, x: number, y: number): void;
  beginPaneDrag(sourcePaneId: string, sessionId: string, x: number, y: number): void;
  updatePointer(x: number, y: number): void;
  setDropTarget(target: DropTarget | null): void;
  endDrag(): void;
  cancelDrag(): void;
}

const thresholdPx = 5;

const initial = {
  isPointerDown: false,
  isDragging: false,
  dragType: null,
  sessionId: null,
  sourcePaneId: null,
  sourceTitlebarKey: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  dropTarget: null,
};

export const useDragStore = create<DragStore>((set) => ({
  ...initial,
  lastDragEndedAt: 0,

  beginTabDrag: (sessionId, x, y, titlebarKey) => set({ ...initial, isPointerDown: true, dragType: "tab", sourceTitlebarKey: titlebarKey ?? `session:${sessionId}`, sessionId, startX: x, startY: y, currentX: x, currentY: y }),
  beginSplitTabDrag: (tabId, x, y) => set({ ...initial, isPointerDown: true, dragType: "tab", sourceTitlebarKey: `split:${tabId}`, startX: x, startY: y, currentX: x, currentY: y }),
  beginPaneDrag: (sourcePaneId, sessionId, x, y) => set({ ...initial, isPointerDown: true, dragType: "pane", sourcePaneId, sessionId, startX: x, startY: y, currentX: x, currentY: y }),
  updatePointer: (x, y) => set((state) => {
    if (!state.isPointerDown) return {};
    const moved = Math.abs(x - state.startX) > thresholdPx || Math.abs(y - state.startY) > thresholdPx;
    return { currentX: x, currentY: y, isDragging: state.isDragging || moved };
  }),
  setDropTarget: (target) => set({ dropTarget: target }),
  endDrag: () => set((state) => ({ ...initial, lastDragEndedAt: state.isDragging ? Date.now() : state.lastDragEndedAt })),
  cancelDrag: () => set({ ...initial, lastDragEndedAt: Date.now() }),
}));

export function shouldSuppressDragClick() {
  return Date.now() - useDragStore.getState().lastDragEndedAt < 50;
}
