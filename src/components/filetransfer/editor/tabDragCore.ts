import type { DiffSide, EditorTab } from "@/stores/editorStore";

export type DropZone = "before" | "diff" | "after";

export function dropIntent(relX: number, width: number, allowDiff: boolean): DropZone {
  if (!allowDiff) return relX < width / 2 ? "before" : "after";
  const edge = width * 0.25;
  if (relX < edge) return "before";
  if (relX > width - edge) return "after";
  return "diff";
}

// `to` is an insertion index into the ORIGINAL array; adjusted for removal.
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return arr.slice();
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  const insert = from < to ? to - 1 : to;
  copy.splice(Math.max(0, Math.min(insert, copy.length)), 0, item);
  return copy;
}

function sameSide(a: DiffSide, b: DiffSide): boolean {
  return a.sftpId === b.sftpId && a.path === b.path;
}

export function samePairUnordered(
  left: DiffSide, right: DiffSide, a: DiffSide, b: DiffSide,
): boolean {
  return (sameSide(left, a) && sameSide(right, b)) ||
         (sameSide(left, b) && sameSide(right, a));
}

export function editorDiffSide(relX: number, width: number): "left" | "right" {
  return relX < width / 2 ? "left" : "right";
}

function toSide(t: { sftpId: string | null; path: string; hostLabel: string }): DiffSide {
  return { sftpId: t.sftpId, path: t.path, hostLabel: t.hostLabel };
}

// Resolve the [left, right] pair for dropping `dragged` onto the editor area
// over `active`. Returns null when the drop is invalid (no active tab, dragged
// is not a file, or it would diff the active single file against itself).
export function resolveEditorDiff(
  dragged: EditorTab | undefined,
  active: EditorTab | null,
  side: "left" | "right",
): [DiffSide, DiffSide] | null {
  if (!dragged || dragged.kind !== "file" || !active) return null;
  if (active.kind === "file") {
    if (active.id === dragged.id) return null;
    const d = toSide(dragged);
    const f = toSide(active);
    return side === "left" ? [d, f] : [f, d];
  }
  const d = toSide(dragged);
  return side === "left" ? [d, active.right] : [active.left, d];
}
