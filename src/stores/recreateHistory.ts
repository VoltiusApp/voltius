import { useHistoryStore } from "@/stores/historyStore";

interface RecreateOptions<T extends { id: string }, D> {
  label: string;
  /** Id to act on until a redo/undo has recreated the object under a new one. */
  id: string;
  /** Payload the object is recreated from. For a delete, the pre-delete form data. */
  data: D;
  create: (data: D) => Promise<T>;
  remove: (id: string) => Promise<void>;
}

/**
 * A create and a delete are the same undo pair with the directions swapped: one
 * side recreates from `data`, the other removes. Recreating mints a new id, so
 * both sides share a closed-over `recreatedId` that the removing side prefers.
 */
function recreatePair<T extends { id: string }, D>(opts: RecreateOptions<T, D>) {
  let recreatedId: string | null = null;
  return {
    recreate: async () => {
      const r = await opts.create(opts.data);
      recreatedId = r.id;
    },
    remove: async () => {
      await opts.remove(recreatedId ?? opts.id);
      recreatedId = null;
    },
  };
}

/** Records a creation: undo removes the object, redo recreates it. */
export function pushCreateHistory<T extends { id: string }, D>(opts: RecreateOptions<T, D>): void {
  const pair = recreatePair(opts);
  useHistoryStore.getState().push({ label: opts.label, undo: pair.remove, redo: pair.recreate });
}

/** Records a deletion: undo recreates the object, redo removes it again. */
export function pushDeleteHistory<T extends { id: string }, D>(opts: RecreateOptions<T, D>): void {
  const pair = recreatePair(opts);
  useHistoryStore.getState().push({ label: opts.label, undo: pair.recreate, redo: pair.remove });
}
