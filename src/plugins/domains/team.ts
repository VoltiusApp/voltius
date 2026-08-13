import type { Team, TeamMember, TeamRole, PendingInvitation } from "@/services/teamService";
import type { TeamVaultStatus } from "@/stores/teamVaultStateStore";
import { failed, type DomainResult } from "./result";

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

export interface PluginTeam {
  id: string; name: string; ownerTier: string; myRoles: string[]; vaultStatus: string;
}
export interface PluginTeamMember {
  userId: string; displayName: string; roles: string[]; isOnline: boolean; state: "member" | "pending";
}
export interface PluginMemberKeyState {
  userId: string; displayName: string; hasPublicKey: boolean; hasWrappedKey: boolean;
}
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

/** One member's key row, or null when the team's key state cannot be read. */
async function memberKey(ports: TeamPorts, teamId: string, userId: string): Promise<PluginMemberKeyState | null> {
  const [status] = await keyStatus(ports, teamId);
  return status.members.find((m) => m.userId === userId) ?? null;
}

export async function inviteMember(
  ports: TeamPorts,
  input: { teamId: string; email?: string; userId?: string; role?: string },
): Promise<DomainResult<{ status: "pending" | "already_member" | "invited"; key: PluginMemberKeyState | null }>> {
  if (Boolean(input.email) === Boolean(input.userId)) {
    return { ok: false, error: "give exactly one of email or userId" };
  }
  try {
    // An email invite creates no member row yet, so there is no key state to
    // report; an id invite may land on someone already present, whose key
    // state is exactly what the caller needs to see.
    if (input.email) {
      await ports.addMember(input.teamId, input.email, input.role);
      return { ok: true, result: { status: "invited", key: null } };
    }
    const { status } = await ports.addMemberById(input.teamId, input.userId!, input.role);
    return { ok: true, result: { status, key: await memberKey(ports, input.teamId, input.userId!) } };
  } catch (err) {
    return failed(err);
  }
}

export async function removeMember(ports: TeamPorts, teamId: string, userId: string): Promise<DomainResult<null>> {
  try {
    await ports.removeMember(teamId, userId);
    return { ok: true, result: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * There is no set-role primitive: the store only adds and removes. The removes
 * run first so a role cap on the server cannot reject the assign, which means a
 * failed assign leaves the member with nothing — reported, never swallowed.
 */
export async function setMemberRole(
  ports: TeamPorts, teamId: string, userId: string, roleId: string,
): Promise<DomainResult<null>> {
  try {
    await ports.loadMembers(teamId);
  } catch (err) {
    return failed(err);
  }
  const target = ports.members(teamId).find((m) => m.user_id === userId);
  if (!target) return { ok: false, error: "no such member in that team" };
  try {
    for (const existing of target.role_ids) {
      if (existing !== roleId) await ports.removeMemberRole(teamId, userId, existing);
    }
  } catch (err) {
    return failed(err);
  }
  try {
    await ports.assignMemberRole(teamId, userId, roleId);
    return { ok: true, result: null };
  } catch (err) {
    return {
      ok: false,
      error: `removed the previous roles but could not assign ${roleId} (${failed(err).error}); ${userId} now holds no role in ${teamId}`,
    };
  }
}
