import { useHistoryStore } from "@/stores/historyStore";
import type { SecretObjectKind } from "@/services/teamVaultSecretKeys";

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

interface UpdateOptions<D extends { vault_id?: string | null }> {
  label: string;
  kind: SecretObjectKind;
  id: string;
  before: D;
  after: D;
  update: (id: string, data: D) => Promise<unknown>;
}

export function pushUpdateHistory<D extends { vault_id?: string | null }>(opts: UpdateOptions<D>): void {
  const { kind, id, before, after, update } = opts;
  const replay = (from: D, to: D) => async () => {
    const { moveWithSecrets } = await import("@/services/vaultObjectSecrets");
    await moveWithSecrets(kind, { id, vault_id: from.vault_id ?? to.vault_id }, to.vault_id, () => update(id, to));
  };
  useHistoryStore.getState().push({ label: opts.label, undo: replay(after, before), redo: replay(before, after) });
}
