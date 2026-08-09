import { useMemo } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import type { VaultOption } from "@/types";

/**
 * The vaults an object may be moved or copied into: personal, the configured
 * vaults under the id objects actually carry (the team id for a linked team
 * vault), and — unless the caller opts out — teams with no vault of their own yet.
 *
 * `includeUnlinkedTeams: false` is what the port forwarding page has always done;
 * its list is the vaults alone.
 */
export function useVaultOptions({ includeUnlinkedTeams = true } = {}): VaultOption[] {
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);

  return useMemo(() => {
    const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
    return [
      { id: "personal", name: "Personal" },
      ...vaults.filter((v) => v.id !== "personal").map((v) => ({ id: v.teamId ?? v.id, name: v.name })),
      ...(includeUnlinkedTeams
        ? teams.filter((t) => !linkedTeamIds.has(t.id)).map((t) => ({ id: t.id, name: t.name }))
        : []),
    ];
  }, [vaults, teams, includeUnlinkedTeams]);
}
