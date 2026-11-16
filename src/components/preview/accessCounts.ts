import { PERM_BITS } from "@/services/permissions";
import type { Preview } from "@/services/permissionPreview";
import type { TeamAccessEntries } from "@/stores/teamObjectAccessStore";
import type { TeamObjectType } from "@/services/teamObjects";

export interface AccessCounts {
  hosts: number;
  snippets: number;
  keys: number;
  hidden: number;
}

const BUCKET: Partial<Record<TeamObjectType, "hosts" | "snippets" | "keys">> = {
  connection: "hosts",
  snippet: "snippets",
  key: "keys",
  identity: "keys",
};

export function countAccess(entries: TeamAccessEntries, current: Preview): AccessCounts {
  const counts: AccessCounts = { hosts: 0, snippets: 0, keys: 0, hidden: 0 };
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.deleted) continue;
    if (((current.objects[id]?.mask ?? 0) & PERM_BITS.VIEW) === 0) counts.hidden++;
    else {
      const bucket = BUCKET[entry.type];
      if (bucket) counts[bucket]++;
    }
  }
  return counts;
}
