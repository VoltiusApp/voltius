import type { TeamObjectRecord } from "@/services/teamObjects";
import type { TeamAccessEntries } from "@/stores/teamObjectAccessStore";

export function parentIdOf(item: object): string | null {
  const { folder_id, parent_folder_id } = item as { folder_id?: string | null; parent_folder_id?: string | null };
  return folder_id ?? parent_folder_id ?? null;
}

export function buildAccessEntries(
  rows: TeamObjectRecord[],
  decoded: Map<string, object>,
): { entries: TeamAccessEntries; supported: boolean | null } {
  const entries: TeamAccessEntries = {};
  for (const row of rows) {
    const deleted = !!row.deleted_at;
    const metadata = decoded.get(row.object_id);
    if (!deleted && !metadata) continue;
    entries[row.object_id] = {
      type: row.object_type,
      ruleSetId: row.rule_set_id ?? null,
      myPermissions: row.my_permissions ?? 0,
      parentId: metadata ? parentIdOf(metadata) : null,
      deleted,
    };
  }
  const supported = rows.length === 0 ? null : rows.some((r) => typeof r.my_permissions === "number");
  return { entries, supported };
}
