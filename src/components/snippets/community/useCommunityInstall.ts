import { useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { installCatalogEntries, type EntrySelection } from "@/services/snippetCatalogInstall";
import { resolveInstallVault } from "@/services/import-export/storeAccess";

export function useInstallTargetVault() {
  const selectedVaultIds = useVaultStore(s => s.selectedVaultIds);
  const vaults = useVaultStore(s => s.vaults);
  return resolveInstallVault({ selectedVaultIds, vaults });
}

export function useCommunityInstall() {
  const vault = useInstallTargetVault();
  const [installing, setInstalling] = useState(false);

  async function install(selections: EntrySelection[]) {
    setInstalling(true);
    try {
      return await installCatalogEntries(selections, vault.id);
    } finally {
      setInstalling(false);
    }
  }

  return { install, installing, vault };
}
