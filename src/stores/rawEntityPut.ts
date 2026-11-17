import { invoke } from "@/lib/invoke";
import type { TimestampedEntity } from "@/services/crdt";
import { serialMerge } from "@/services/serialMerge";
import { syncAfterEdit } from "@/stores/syncAfterEdit";

export async function putRawEntity(
  file: string,
  typeId: string,
  entry: TimestampedEntity,
  reload: () => Promise<void>,
): Promise<void> {
  try {
    await serialMerge(() => invoke("raw_entity_put", { file, entry }));
    syncAfterEdit(typeId, entry.id);
  } catch (e) {
    await reload();
    throw e;
  }
}
