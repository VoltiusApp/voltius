import { resolveCan, type Permission } from "@/services/permissions";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { getMyUserId } from "@/services/teamService";
import type { TeamObjectType } from "@/services/teamObjects";

/** Server-side truth is `edit_permission_for_str` in routes/team_objects.rs. */
const EDIT_PERMISSION: Record<string, Permission> = {
  connection: "EDIT_CONNECTIONS",
  port_forwarding_rule: "EDIT_CONNECTIONS",
  snippet: "EDIT_SNIPPETS",
  identity: "EDIT_IDENTITIES",
  key: "EDIT_KEYS",
  folder: "EDIT_FOLDERS",
  snippet_folder: "EDIT_FOLDERS",
};

export interface EditPermissionSnapshot {
  myUserId: string;
  teams: ReturnType<typeof useTeamStore.getState>["teams"];
  membersByTeam: ReturnType<typeof useTeamStore.getState>["membersByTeam"];
  rolesByTeam: ReturnType<typeof useTeamStore.getState>["rolesByTeam"];
  vaults: ReturnType<typeof useVaultStore.getState>["vaults"];
}

/** A point-in-time snapshot of what the caller may edit, built once per pass
 * rather than re-reading the stores per object (both the #229 migration pass
 * and the #217 rotation pass need this identical shape). */
export async function buildEditPermissionSnapshot(): Promise<EditPermissionSnapshot> {
  let myUserId = "";
  try {
    myUserId = (await getMyUserId()) ?? "";
  } catch {
    // ignore — resolveCan treats a blank id as "no access"
  }

  return {
    myUserId,
    teams: useTeamStore.getState().teams,
    membersByTeam: useTeamStore.getState().membersByTeam,
    rolesByTeam: useTeamStore.getState().rolesByTeam,
    vaults: useVaultStore.getState().vaults,
  };
}

export function canEditObjectType(
  snapshot: EditPermissionSnapshot,
  teamId: string,
  objectType: TeamObjectType | string,
): boolean {
  const permission = EDIT_PERMISSION[objectType];
  return permission !== undefined && resolveCan(snapshot, permission, teamId);
}
