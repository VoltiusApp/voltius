import { useState } from "react";
import { useImportStores, useReloadFns } from "@/components/import-export/useStores";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useVaultStore } from "@/stores/vaultStore";
import { runImport, reloadAll } from "@/services/import-export/registry";
import { bundleFromEntries, type EntrySelection } from "@/services/snippetCatalogInstall";

export function useInstallTargetVault() {
  const selectedVaultIds = useVaultStore(s => s.selectedVaultIds);
  const vaults = useVaultStore(s => s.vaults);
  const id = selectedVaultIds[0] ?? "personal";
  return { id, name: vaults.find(v => v.id === id)?.name ?? id };
}

export function useCommunityInstall() {
  const stores = useImportStores();
  const reloaders = useReloadFns();
  const existingSnippets = useAllSnippets();
  const vault = useInstallTargetVault();
  const [installing, setInstalling] = useState(false);

  async function install(selections: EntrySelection[]) {
    setInstalling(true);
    try {
      // The folder a pack lands in is created by runImport, before the snippets
      // that reference it — calling the handler directly would drop folder_id.
      return await runImport(bundleFromEntries(selections), {
        vault_id: vault.id,
        tag: "",
        skipDupes: true,
        existingConnections: [], existingKeys: [], existingIdentities: [],
        existingSnippets,
        existingPfRules: [],
        folderEidMap: new Map(), snippetFolderEidMap: new Map(), keyEidMap: new Map(),
        identityEidMap: new Map(), connectionEidMap: new Map(),
        stores,
      });
    } finally {
      await reloadAll(reloaders);
      setInstalling(false);
    }
  }

  return { install, installing, vault };
}
