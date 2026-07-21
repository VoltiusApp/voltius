/** Reorder `list` by moving `fromId` relative to `toId`. Pure; returns a new
 *  array (or the input unchanged when the move is a no-op / ids are missing).
 *  Extracted verbatim from JumpHostsPanel's drop logic so behavior matches. */
export function reorder<T extends { id: string }>(
  list: T[],
  fromId: string,
  toId: string,
  pos: "before" | "after",
): T[] {
  if (fromId === toId) return list;
  const fromIdx = list.findIndex((x) => x.id === fromId);
  const toIdx = list.findIndex((x) => x.id === toId);
  if (fromIdx === -1 || toIdx === -1) return list;
  const next = [...list];
  const [item] = next.splice(fromIdx, 1);
  const insertAt =
    pos === "before"
      ? (fromIdx < toIdx ? toIdx - 1 : toIdx)
      : (fromIdx < toIdx ? toIdx : toIdx + 1);
  next.splice(Math.max(0, insertAt), 0, item);
  return next;
}
