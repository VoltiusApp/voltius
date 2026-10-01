import { useMemo } from "react";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useVaultStore } from "@/stores/vaultStore";
import { vaultById } from "@/services/vaultLookup";

type VaultScoped = { vault_id?: string | null };

export interface VaultScope {
  inScope: (item: VaultScoped) => boolean;
  /** The vault on screen under the id its objects carry — the team id for a linked team vault. */
  createVaultId: string;
}

export function useVaultScope(): VaultScope {
  const accessibleVaultIds = useAccessibleVaultIds();
  const selected = useVaultStore((s) => s.selectedVaultIds[0] ?? "personal");
  const createVaultId = useVaultStore((s) => vaultById(s.vaults, selected)?.teamId ?? selected);
  return useMemo(() => {
    const ids = new Set(accessibleVaultIds);
    return { inScope: (item) => ids.has(item.vault_id ?? "personal"), createVaultId };
  }, [accessibleVaultIds, createVaultId]);
}
