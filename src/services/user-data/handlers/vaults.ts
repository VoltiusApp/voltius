import i18n from "@/i18n";
import { useVaultStore } from "@/stores/vaultStore";
import {
  isAliveVaultRow,
  mergeVaultSections,
  newestVaultTimestamp,
  parseVaultsSection,
  vaultsSectionFrom,
  type VaultsSection,
} from "@/services/vaultSection";
import type { UserDataHandler } from "../handler";

function section(): VaultsSection {
  const { vaults, deletedVaults } = useVaultStore.getState();
  return vaultsSectionFrom(vaults, deletedVaults);
}

// The one section that does not merge `lastWriteWins` — see `services/vaultSection`.
export const vaultsHandler: UserDataHandler = {
  key: "vaults",
  label: "Vaults",
  icon: "lucide:vault",

  export(): VaultsSection {
    return section();
  },

  async import(data: unknown): Promise<void> {
    useVaultStore.getState().applySyncedVaults(parseVaultsSection(data));
  },

  merge: (local, remote) => mergeVaultSections(local, remote),

  getTimestamp(): string {
    return newestVaultTimestamp(section());
  },

  // No-op by design: the vaults timestamp is the newest row clock, and vaults
  // is never user-toggleable, so there is no re-enable to publish.
  touch(): void {},

  describe(): string {
    return i18n.t("importExport.userData.describe.vaults", {
      count: Object.values(section()).filter(isAliveVaultRow).length,
    });
  },
};
