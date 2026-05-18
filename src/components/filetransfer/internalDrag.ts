// Pointer-event-driven drag/drop between FilePanes. We can't rely on HTML5
// drag because Tauri's OS drag-drop handler (dragDropEnabled: true) intercepts
// it on Windows, so this module reimplements the drag flow on top of
// pointer events: gesture start → ghost overlay → hit-test → drop dispatch.
//
// Two state slices are emitted independently so high-frequency cursor moves
// don't re-render hit-test consumers like FilePane:
//   - `move`     — cursor position, updates every pointermove (ghost only)
//   - `semantic` — { side, files, hoverSide, hoverFolder }, changes only when
//                  crossing into a different drop target

import { useSyncExternalStore } from "react";
import type { FileEntry } from "./SFTPTypes";

export type DragSide = "left" | "right";

// `side: "external"` indicates an OS-originated drag (files from Finder /
// Explorer). The drop overlay logic treats this like any other foreign side,
// so both panes will show themselves as valid drop targets.
export type SemanticState = {
  side: DragSide | "external";
  files: FileEntry[];
  hoverSide: DragSide | null;
  hoverFolder: string | null;
} | null;

export type MoveState = { x: number; y: number };

let semantic: SemanticState = null;
let move: MoveState = { x: 0, y: 0 };
const semanticListeners = new Set<() => void>();
const moveListeners = new Set<() => void>();

function emitSemantic() { semanticListeners.forEach((fn) => fn()); }
function emitMove() { moveListeners.forEach((fn) => fn()); }

export function getSemantic(): SemanticState { return semantic; }
export function getMove(): MoveState { return move; }

function setSemantic(next: SemanticState) {
  // Reference equality check avoids spurious re-renders when nothing changed.
  if (
    next === semantic ||
    (next && semantic &&
      next.side === semantic.side &&
      next.files === semantic.files &&
      next.hoverSide === semantic.hoverSide &&
      next.hoverFolder === semantic.hoverFolder)
  ) return;
  semantic = next;
  emitSemantic();
}

function setMove(x: number, y: number) {
  move = { x, y };
  emitMove();
}

export function subscribeSemantic(fn: () => void) {
  semanticListeners.add(fn);
  return () => { semanticListeners.delete(fn); };
}
export function subscribeMove(fn: () => void) {
  moveListeners.add(fn);
  return () => { moveListeners.delete(fn); };
}

export function useSemanticDragState(): SemanticState {
  return useSyncExternalStore(subscribeSemantic, getSemantic, getSemantic);
}
export function useMoveDragState(): MoveState {
  return useSyncExternalStore(subscribeMove, getMove, getMove);
}

const DRAG_THRESHOLD_PX = 5;

type StartOpts = {
  side: DragSide;
  files: FileEntry[];
  startX: number;
  startY: number;
  onDrop: (files: FileEntry[], fromSide: DragSide, targetFolder?: string) => void;
  /** Called when the drag actually starts (threshold met). Used by the source
   *  pane to select the row if it wasn't already selected. */
  onActivate?: () => void;
};

// Hit-test the cursor position against pane/folder drop targets. Folder drops
// only count when the cursor is over a folder belonging to a pane other than
// `sourceSide` — pass null to allow any pane (used for OS-originated drops).
export function hitTestDropTarget(
  x: number,
  y: number,
  sourceSide: DragSide | null,
): { side: DragSide | null; folder: string | null } {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return { side: null, folder: null };
  const sideEl = el.closest<HTMLElement>("[data-drop-side]");
  if (!sideEl) return { side: null, folder: null };
  const side = sideEl.dataset.dropSide as DragSide;
  if (sourceSide !== null && side === sourceSide) return { side: null, folder: null };
  const folderEl = el.closest<HTMLElement>("[data-drop-folder]");
  const folder = folderEl?.dataset.dropFolder ?? null;
  return { side, folder };
}

// External (OS-originated) drag overlay control. Used by SFTPPage when
// Tauri's onDragDropEvent fires for files dragged from the OS.
export function setExternalDragHover(hoverSide: DragSide | null, hoverFolder: string | null) {
  setSemantic({ side: "external", files: [], hoverSide, hoverFolder });
}
export function clearExternalDragHover() {
  if (semantic?.side === "external") setSemantic(null);
}

export function startInternalDragGesture(opts: StartOpts) {
  let armed = true;            // potential-drag phase, before threshold
  let active = false;          // true once we've activated and emitted semantic state
  let movedFar = false;        // tracks if drag actually occurred — used to suppress click

  const onMove = (ev: PointerEvent) => {
    if (armed) {
      const dx = ev.clientX - opts.startX;
      const dy = ev.clientY - opts.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      armed = false;
      active = true;
      movedFar = true;
      opts.onActivate?.();
      setMove(ev.clientX, ev.clientY);
      const hit = hitTestDropTarget(ev.clientX, ev.clientY, opts.side);
      setSemantic({ side: opts.side, files: opts.files, hoverSide: hit.side, hoverFolder: hit.folder });
      return;
    }
    if (!active) return;
    setMove(ev.clientX, ev.clientY);
    const hit = hitTestDropTarget(ev.clientX, ev.clientY, opts.side);
    setSemantic({ side: opts.side, files: opts.files, hoverSide: hit.side, hoverFolder: hit.folder });
  };

  const onUp = (ev: PointerEvent) => {
    cleanup();
    if (!active) return;
    const hit = hitTestDropTarget(ev.clientX, ev.clientY, opts.side);
    setSemantic(null);
    if (hit.side && hit.side !== opts.side) {
      opts.onDrop(opts.files, opts.side, hit.folder ?? undefined);
    }
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    cleanup();
    if (active) setSemantic(null);
  };

  // Suppress the synthetic click that follows pointerup when a real drag
  // occurred — otherwise the source row would receive a click and the
  // pane's selection would change unexpectedly after the drop.
  const onClickCapture = (ev: MouseEvent) => {
    if (!movedFar) return;
    ev.stopPropagation();
    ev.preventDefault();
    window.removeEventListener("click", onClickCapture, true);
  };

  function cleanup() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("keydown", onKey);
    // Click handler is removed by itself after firing, but if no click
    // fires (e.g., pointercancel) we still want to clean up shortly.
    setTimeout(() => window.removeEventListener("click", onClickCapture, true), 0);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("keydown", onKey);
  window.addEventListener("click", onClickCapture, true);
}
