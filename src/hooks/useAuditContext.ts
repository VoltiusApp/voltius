import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import type { AuditContext } from "@/services/auditContext";

export function useSelectedAuditContext(): AuditContext | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);

  if (selectedVaultIds.length !== 1) return null;
  const vid = selectedVaultIds[0];

  const team = teams.find((t) => t.id === vid);
  if (team) return { kind: "team", teamId: team.id };

  const vault = vaults.find((v) => v.id === vid);
  if (!vault) return null;
  if (vault.teamId) return { kind: "team", teamId: vault.teamId, vaultId: vault.id };

  return { kind: "local", vaultId: vault.id };
}
