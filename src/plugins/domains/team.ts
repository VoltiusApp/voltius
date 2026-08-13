import type { Team, TeamMember, TeamRole, PendingInvitation } from "@/services/teamService";
import type { TeamVaultStatus } from "@/stores/teamVaultStateStore";

/**
 * The team operations this domain needs, as plain functions. Every `load*` is
 * the network refresh for the `*` reader beside it: the stores are populated
 * lazily by the pages, so a verb that reads without loading first sees whatever
 * the UI happened to have visited.
 */
export interface TeamPorts {
  teams(): Team[];
  loadTeams(): Promise<void>;
  members(teamId: string): TeamMember[];
  loadMembers(teamId: string): Promise<void>;
  pendingInvitations(teamId: string): PendingInvitation[];
  loadPendingInvitations(teamId: string): Promise<void>;
  roles(teamId: string): TeamRole[];
  loadRoles(teamId: string): Promise<void>;
  vaultStatus(teamId: string): TeamVaultStatus;
  keyHolders(teamId: string): Promise<string[]>;
  myUserId(): Promise<string | null>;
  addMember(teamId: string, email: string, role?: string): Promise<void>;
  addMemberById(teamId: string, userId: string, role?: string): Promise<{ status: "pending" | "already_member" }>;
  removeMember(teamId: string, userId: string): Promise<void>;
  assignMemberRole(teamId: string, userId: string, roleId: string): Promise<void>;
  removeMemberRole(teamId: string, userId: string, roleId: string): Promise<void>;
}

export interface PluginTeam { id: string; name: string; ownerTier: string; myRoles: string[]; vaultStatus: string }
export interface PluginTeamMember {
  userId: string; displayName: string; roles: string[]; isOnline: boolean; state: "member" | "pending";
}
export interface PluginMemberKeyState { userId: string; displayName: string; hasPublicKey: boolean; hasWrappedKey: boolean }
export interface PluginTeamKeyStatus {
  teamId: string; vaultStatus: string; iHoldKey: boolean; members: PluginMemberKeyState[];
}

const roleNames = (ports: TeamPorts, teamId: string, ids: string[]): string[] => {
  const byId = new Map(ports.roles(teamId).map((r: TeamRole) => [r.id, r.name]));
  return ids.map((id) => byId.get(id) ?? id);
};

export async function listTeams(ports: TeamPorts): Promise<PluginTeam[]> {
  await ports.loadTeams();
  const teams = ports.teams();
  await Promise.all(teams.map((t: Team) => ports.loadRoles(t.id)));
  return teams.map((t: Team) => ({
    id: t.id,
    name: t.name,
    ownerTier: t.owner_tier,
    myRoles: roleNames(ports, t.id, t.role_ids),
    vaultStatus: ports.vaultStatus(t.id),
  }));
}

export async function listMembers(ports: TeamPorts, teamId: string): Promise<PluginTeamMember[]> {
  await Promise.all([ports.loadMembers(teamId), ports.loadPendingInvitations(teamId), ports.loadRoles(teamId)]);
  const joined = ports.members(teamId).map((m: TeamMember) => ({
    userId: m.user_id,
    displayName: m.display_name,
    roles: roleNames(ports, teamId, m.role_ids),
    isOnline: m.is_online ?? false,
    state: "member" as const,
  }));
  // An invitation carries a role NAME, not an id, and no online state: an
  // invitee has no client in the team yet.
  const pending = ports.pendingInvitations(teamId).map((p: PendingInvitation) => ({
    userId: p.id,
    displayName: p.display_name,
    roles: [p.role],
    isOnline: false,
    state: "pending" as const,
  }));
  return [...joined, ...pending];
}

export async function keyStatus(ports: TeamPorts, teamId?: string): Promise<PluginTeamKeyStatus[]> {
  await ports.loadTeams();
  const ids = teamId ? [teamId] : ports.teams().map((t: Team) => t.id);
  const me = await ports.myUserId();
  return Promise.all(ids.map(async (id) => {
    await ports.loadMembers(id);
    // A team the caller cannot read answers 403 here. That is data, not a
    // failure: report an empty holder set beside the vault status that says why.
    const holders = new Set(await ports.keyHolders(id).catch(() => [] as string[]));
    return {
      teamId: id,
      vaultStatus: ports.vaultStatus(id),
      iHoldKey: me !== null && holders.has(me),
      members: ports.members(id).map((m: TeamMember) => ({
        userId: m.user_id,
        displayName: m.display_name,
        hasPublicKey: Boolean(m.public_key),
        hasWrappedKey: holders.has(m.user_id),
      })),
    };
  }));
}
