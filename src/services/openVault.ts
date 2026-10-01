import { useVaultStore } from "@/stores/vaultStore";
import { onVaultSelect } from "@/services/teamDataManager";

/** Show one vault alone, loading a team vault's data if it has not loaded yet. */
export function openVault(vaultId: string, teamId?: string | null): void {
  useVaultStore.getState().selectVaultOnly(vaultId);
  if (teamId) onVaultSelect(teamId).catch(() => {});
}
