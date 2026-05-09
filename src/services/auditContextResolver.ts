import type { AuditContext } from "@/services/auditContext";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

export function auditContextForVaultId(vaultId?: string | null): AuditContext {
  const id = vaultId || "personal";
  const { teams } = useTeamStore.getState();
  const { vaults } = useVaultStore.getState();

  if (teams.some((team) => team.id === id)) {
    return { kind: "team", teamId: id };
  }

  const vault = vaults.find((v) => v.id === id);
  if (vault?.teamId) {
    return { kind: "team", teamId: vault.teamId, vaultId: vault.id };
  }

  return { kind: "local", vaultId: id };
}
