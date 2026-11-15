import { pasteFromClipboard, runPaste, type CascadeEntry, type PasteResult } from "@/services/vaultClipboard";
import type { Permission } from "@/hooks/usePermission";
import { clipboardOf } from "@/hooks/usePageClipboard";
import { headlessVaultObjectsAdapter, type VaultObjectTab } from "@/services/clipboard/vaultObjectsAdapter";
import type { VaultObjectPorts } from "@/services/vaultObjectWrites";

export interface PreparedTransfer {
  cascade: CascadeEntry[];
  run: () => Promise<PasteResult>;
}

/** A "move/copy to vault" with no page: the paste into that vault's root, planned before it runs. */
export function prepareVaultTransfer(input: {
  ports: VaultObjectPorts;
  tab: VaultObjectTab;
  ids: string[];
  vaultId: string;
  mode: "copy" | "cut";
  can: (permission: Permission, vaultId: string, objectId?: string) => boolean;
}): PreparedTransfer | null {
  const adapter = headlessVaultObjectsAdapter({
    tab: input.tab, ports: input.ports, can: input.can, folderId: null, vaultId: input.vaultId,
  });
  const clipboard = clipboardOf(adapter, input.ids, input.mode);
  if (!clipboard) return null;
  return {
    cascade: adapter.planCascade?.(clipboard.items, clipboard.folderIds, input.vaultId, input.mode) ?? [],
    run: () => runPaste(() => pasteFromClipboard(clipboard, adapter)),
  };
}
