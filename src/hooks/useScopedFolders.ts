import { useMemo } from "react";
import type { Folder } from "@/types";

/**
 * The folders a page may show: those of its own object type, in a vault the
 * current selection can reach. An empty `accessibleVaultIds` means "not scoped
 * to any vault", which shows everything rather than nothing.
 *
 * `objectType` is omitted by the snippets page, whose folders live in their own
 * store and are all snippet folders already.
 */
export function useScopedFolders(
  folders: Folder[],
  accessibleVaultIds: string[],
  objectType?: string,
): Folder[] {
  return useMemo(
    () => folders.filter((f) => {
      if (objectType !== undefined && f.object_type !== objectType) return false;
      const fvid = f.vault_id ?? "personal";
      return accessibleVaultIds.length === 0 || accessibleVaultIds.includes(fvid);
    }),
    [folders, accessibleVaultIds, objectType],
  );
}
