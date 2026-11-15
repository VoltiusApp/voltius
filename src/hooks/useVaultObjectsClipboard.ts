import { useMemo, useRef } from "react";
import { usePageClipboard, type TransferToVault } from "@/hooks/usePageClipboard";
import {
  createPasteState,
  vaultObjectsAdapter,
  type VaultObjectTab,
  type VaultObjectsAdapterInput,
} from "@/services/clipboard/vaultObjectsAdapter";
import { hydrateVaultObjectStores, storeObjectPorts } from "@/services/vaultObjectStores";

type PageView = Omit<VaultObjectsAdapterInput, "tab" | "ports" | "state" | "selectedIds" | "hydrate"> & {
  selectedIdSet: Set<string>;
};

/** A vault-object page's Ctrl+X/C/V and its "move/copy to vault" menu, both through the one paste. */
export function useVaultObjectsClipboard(tab: VaultObjectTab, { selectedIdSet, ...view }: PageView) {
  // Owned here, not by the adapter: a store write mid-paste re-renders the page and rebuilds it.
  const state = useRef(createPasteState());
  const transferToVault: TransferToVault = usePageClipboard(vaultObjectsAdapter({
    ...view,
    tab,
    ports: storeObjectPorts,
    state: state.current,
    selectedIds: [...selectedIdSet],
    hydrate: hydrateVaultObjectStores,
  }));
  return useMemo(() => ({
    transferToVault,
    moveToVault: (o: { id: string }, vaultId: string) => transferToVault([o.id], vaultId, "cut"),
    copyToVault: (o: { id: string }, vaultId: string) => transferToVault([o.id], vaultId, "copy"),
  }), [transferToVault]);
}
