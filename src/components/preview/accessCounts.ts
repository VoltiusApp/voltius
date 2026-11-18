import { PERM_BITS } from "@/services/permissions";
import type { Preview } from "@/services/permissionPreview";
import type { TeamAccessEntries } from "@/stores/teamObjectAccessStore";
import type { TeamObjectType } from "@/services/teamObjects";
import { keyedMask } from "@/services/previewSnapshot";

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
    const bucket = BUCKET[entry.type];
    if (!bucket) continue;
    if ((keyedMask(current, id) & PERM_BITS.VIEW) === 0) counts.hidden++;
    else counts[bucket]++;
  }
  return counts;
}
