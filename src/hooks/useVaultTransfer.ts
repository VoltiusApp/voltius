import { useCallback } from "react";
import { useCrossVaultPasteConfirm } from "@/hooks/useCrossVaultPasteConfirm";
import { usePermissions } from "@/hooks/usePermission";
import { reportPasteFailure, reportPasteResult } from "@/hooks/usePageClipboard";
import { prepareVaultTransfer } from "@/services/vaultObjectTransfer";
import { hydrateVaultObjectStores, storeObjectPorts } from "@/services/vaultObjectStores";
import type { VaultObjectTab } from "@/services/clipboard/vaultObjectsAdapter";

/** "Move/copy to vault" outside a page clipboard: asks only when references travel along. */
export function useVaultTransfer(tab: VaultObjectTab) {
  const { pending, confirmCrossVault, accept, cancel } = useCrossVaultPasteConfirm();
  const can = usePermissions();

  const transfer = useCallback(
    async (ids: string[], vault: { id: string; name: string }, mode: "copy" | "cut") => {
      try {
        await hydrateVaultObjectStores();
        const prepared = prepareVaultTransfer({ ports: storeObjectPorts, tab, ids, vaultId: vault.id, mode, can });
        if (!prepared) return;
        if (prepared.cascade.length > 0) {
          const ok = await confirmCrossVault({ count: ids.length, targetVaultName: vault.name, mode, cascade: prepared.cascade });
          if (!ok) return;
        }
        reportPasteResult(await prepared.run());
      } catch (e) {
        reportPasteFailure(e);
      }
    },
    [tab, can, confirmCrossVault],
  );

  return { pending, accept, cancel, transfer };
}
