import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useTeamStore } from "@/stores/teamStore";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { selectVaultScopedItems } from "@/utils/vaultScopedItems";

export function useVaultScopedItems<T extends { vault_id?: string }>(
  vaultId: string | null | undefined,
  localItems: T[],
  teamItems: Record<string, T[]>,
): T[] {
  const teamIds = useTeamStore(useShallow((s) => s.teams.map((team) => team.id)));
  return useMemo(
    () => selectVaultScopedItems({
      vaultId: vaultId || "personal",
      localItems,
      teamItems,
      teamVaultIds: new Set(teamIds),
      resolveVaultId: resolveVaultIdForSave,
    }),
    [vaultId, localItems, teamItems, teamIds],
  );
}
