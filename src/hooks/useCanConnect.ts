import type { Connection } from "@/types";
import { usePermissions } from "@/hooks/usePermission";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { resolveTeamIdFromCollections } from "@/services/resolveTeamId";

export function useCanConnect(connection: Pick<Connection, "id" | "vault_id">): boolean {
  const can = usePermissions();
  const teams = useTeamStore((s) => s.teams);
  const vaults = useVaultStore((s) => s.vaults);
  const teamId = resolveTeamIdFromCollections(connection.vault_id, teams, vaults);
  return !teamId || can("CONNECT", teamId, connection.id);
}
