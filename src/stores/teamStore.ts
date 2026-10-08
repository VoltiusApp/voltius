import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import * as api from "@/services/teamService";
import { logFailure } from "@/lib/logger";
import { effectivePermissions } from "@/services/permissions";
import { combineLockPolicies } from "@/services/lockPolicy";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";
import { isBusinessLocked } from "@/stores/subscriptionTier";
import type { CreatedTeam, Team, TeamLockPolicy, TeamMember, TeamRole, PendingInvitation, MyPendingInvitation } from "@/services/teamService";
export type { Team, TeamMember, TeamRole, PendingInvitation, MyPendingInvitation };

interface TeamStore {
  teams: Team[];
  membersByTeam: Record<string, TeamMember[]>;
  rolesByTeam: Record<string, TeamRole[]>;
  pendingInvitationsByTeam: Record<string, PendingInvitation[]>;
  myPendingInvitations: MyPendingInvitation[];
  activeTeamId: string | null;
  loading: boolean;
  /** Our own presence, owned by the realtime layer rather than the server's
   *  members payload — see `setSelfOnline`. Null until the stream first opens. */
  self: { userId: string; online: boolean } | null;

  loadTeams: () => Promise<void>;
  setLockPolicy: (teamId: string, policy: TeamLockPolicy | null) => Promise<void>;
  createTeam: (name: string) => Promise<CreatedTeam>;
  loadMembers: (teamId: string) => Promise<void>;
  addMember: (teamId: string, email: string, role?: string) => Promise<void>;
  addMemberById: (teamId: string, userId: string, role?: string, name?: string) => Promise<{ status: "pending" | "already_member" }>;
  setMemberName: (teamId: string, userId: string, name: string | null) => Promise<void>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  setActiveTeam: (teamId: string | null) => void;
  getActiveMembers: () => TeamMember[];
  setMemberOnline: (userId: string, online: boolean) => void;
  setSelfOnline: (userId: string, online: boolean) => void;
  loadPendingInvitations: (teamId: string) => Promise<void>;
  loadMyPendingInvitations: () => Promise<void>;
  removeTeam: (teamId: string) => void;
  // Roles
  loadRoles: (teamId: string) => Promise<void>;
  createRole: (teamId: string, name: string, permissions: number, color?: string) => Promise<TeamRole>;
  updateRole: (teamId: string, roleId: string, updates: { name?: string; permissions?: number; color?: string; position?: number }) => Promise<void>;
  deleteRole: (teamId: string, roleId: string) => Promise<void>;
  assignMemberRole: (teamId: string, userId: string, roleId: string) => Promise<void>;
  removeMemberRole: (teamId: string, userId: string, roleId: string) => Promise<void>;
  setMemberPermissions: (teamId: string, userId: string, allow: number, deny: number) => Promise<void>;
}

/**
 * Mirrors {teamId -> the user's effective permission bits (role union with
 * allow/deny overrides applied)} into the keychain for the Rust vault-write
 * check. Bits, not role names: a team using a custom-named role with write
 * permissions would be denied locally by a name match even though the server
 * allows it.
 *
 * A team whose roles can't be resolved is left out of the map rather than
 * written as "no permissions" — the server stays authoritative, and guessing
 * would lock the user out of a vault they can write to.
 */
export async function cacheVaultRoles(
  teams: Team[],
  rolesByTeam: Record<string, TeamRole[]>,
  onRolesLoaded: (teamId: string, roles: TeamRole[]) => void,
): Promise<void> {
  const bits: Record<string, number> = {};
  await Promise.all(
    teams.map(async (t) => {
      let roles: TeamRole[] | undefined = rolesByTeam[t.id];
      if (!roles || t.role_ids.some((rid) => !roles!.some((r) => r.id === rid))) {
        const fetched = await api.listRoles(t.id).catch(() => null);
        if (fetched) {
          roles = fetched;
          onRolesLoaded(t.id, fetched);
        }
      }
      if (!roles) return;
      const resolved = t.role_ids
        .map((rid) => roles!.find((r) => r.id === rid)?.permissions)
        .filter((p): p is number => typeof p === "number");
      if (resolved.length < t.role_ids.length) return;
      bits[t.id] = effectivePermissions(t, roles!, isBusinessLocked(t));
    }),
  );
  await invoke("keychain_set", {
    key: "team_vault_roles",
    value: JSON.stringify(bits),
  }).catch(() => {});
}

// Team vaults are online-only: the team list lives in memory, and a copy left by older builds is dropped.
try { localStorage.removeItem("voltius-teams"); } catch {}

export const useTeamStore = create<TeamStore>()(
  (set, get) => ({
  teams: [],
  membersByTeam: {},
  rolesByTeam: {},
  pendingInvitationsByTeam: {},
  myPendingInvitations: [],
  activeTeamId: null,
  loading: false,
  self: null,

  loadTeams: async () => {
    set({ loading: true });
    try {
      const fresh = await api.listTeams();
      const prev = get().teams;
      const same =
        prev.length === fresh.length &&
        fresh.every((t, i) => t.id === prev[i].id && t.name === prev[i].name &&
          t.owner_tier === prev[i].owner_tier &&
          t.permission_allow === prev[i].permission_allow &&
          t.permission_deny === prev[i].permission_deny &&
          JSON.stringify(t.lock_policy ?? null) === JSON.stringify(prev[i].lock_policy ?? null) &&
          JSON.stringify(t.role_ids) === JSON.stringify(prev[i].role_ids));
      const teams = same ? prev : fresh;
      set({ teams, loading: false });
      useOrgLockPolicyStore.getState().setPolicy(combineLockPolicies(teams));
      if (teams.length > 0 && !get().activeTeamId) {
        set({ activeTeamId: teams[0].id });
      }
      await cacheVaultRoles(teams, get().rolesByTeam, (teamId, roles) =>
        set((s) => ({ rolesByTeam: { ...s.rolesByTeam, [teamId]: roles } })),
      );
    } catch (e) {
      // Callers treat an unchanged list as "nothing happened", so a swallowed
      // failure here is what makes a missed removal look like a no-op (#233).
      logFailure("loadTeams")(e);
      set({ loading: false });
    }
  },

  setLockPolicy: async (teamId, policy) => {
    await api.setTeamLockPolicy(teamId, policy);
    await get().loadTeams();
  },

  createTeam: async (name) => {
    const created = await api.createTeam(name);
    // The create reply lacks role_ids and owner_tier; the listed row carries them.
    set((s) => ({ teams: [...s.teams, { ...created, owner_tier: "", role_ids: [] }], activeTeamId: created.id }));
    await get().loadTeams();
    return created;
  },

  loadMembers: async (teamId) => {
    const members = await api.listMembers(teamId);
    // The server derives is_online from its presence map, which only gains our
    // entry once it handles our SSE stream. On a fresh vault this fetch can win
    // that race and report us offline forever (nothing refetches). Our own
    // stream state is the better answer for our own row.
    const self = get().self;
    const withSelf = self
      ? members.map((m) => (m.user_id === self.userId ? { ...m, is_online: self.online } : m))
      : members;
    set((s) => ({ membersByTeam: { ...s.membersByTeam, [teamId]: withSelf } }));
  },

  addMember: async (teamId, email, role) => {
    await api.addMember(teamId, email, role);
    await get().loadMembers(teamId);
  },

  addMemberById: async (teamId, userId, role, name) => {
    const result = await api.addMemberById(teamId, userId, role, name);
    // Pending invites don't appear in the members list yet; reload to pick up any state changes
    await get().loadMembers(teamId);
    return result;
  },

  removeMember: async (teamId, userId) => {
    await api.removeMember(teamId, userId);
    set((s) => ({
      membersByTeam: {
        ...s.membersByTeam,
        [teamId]: (s.membersByTeam[teamId] ?? []).filter((m) => m.user_id !== userId),
      },
    }));
  },

  setActiveTeam: (teamId) => set({ activeTeamId: teamId }),

  loadPendingInvitations: async (teamId) => {
    const invites = await api.listPendingInvitations(teamId).catch(() => [] as PendingInvitation[]);
    set((s) => ({ pendingInvitationsByTeam: { ...s.pendingInvitationsByTeam, [teamId]: invites } }));
  },

  loadMyPendingInvitations: async () => {
    const invites = await api.fetchMyPendingInvitations().catch(() => [] as MyPendingInvitation[]);
    set({ myPendingInvitations: invites });
  },

  removeTeam: (teamId) => {
    set((s) => {
      const { [teamId]: _m, ...membersByTeam } = s.membersByTeam;
      const { [teamId]: _r, ...rolesByTeam } = s.rolesByTeam;
      const { [teamId]: _p, ...pendingInvitationsByTeam } = s.pendingInvitationsByTeam;
      return {
        teams: s.teams.filter((t) => t.id !== teamId),
        membersByTeam,
        rolesByTeam,
        pendingInvitationsByTeam,
        activeTeamId: s.activeTeamId === teamId ? null : s.activeTeamId,
      };
    });
  },

  setSelfOnline: (userId, online) => {
    set({ self: { userId, online } });
    get().setMemberOnline(userId, online);
  },

  setMemberOnline: (userId, online) =>
    set((state) => ({
      membersByTeam: Object.fromEntries(
        Object.entries(state.membersByTeam).map(([teamId, members]) => [
          teamId,
          members.map((m) => m.user_id === userId ? { ...m, is_online: online } : m),
        ])
      ),
    })),

  loadRoles: async (teamId) => {
    const roles = await api.listRoles(teamId);
    set((s) => ({ rolesByTeam: { ...s.rolesByTeam, [teamId]: roles } }));
  },

  createRole: async (teamId, name, permissions, color) => {
    const role = await api.createRole(teamId, name, permissions, color);
    set((s) => ({
      rolesByTeam: {
        ...s.rolesByTeam,
        [teamId]: [...(s.rolesByTeam[teamId] ?? []), role],
      },
    }));
    return role;
  },

  updateRole: async (teamId, roleId, updates) => {
    await api.updateRole(teamId, roleId, updates);
    set((s) => ({
      rolesByTeam: {
        ...s.rolesByTeam,
        [teamId]: (s.rolesByTeam[teamId] ?? []).map((r) =>
          r.id === roleId ? { ...r, ...updates } : r,
        ),
      },
    }));
  },

  deleteRole: async (teamId, roleId) => {
    await api.deleteRole(teamId, roleId);
    set((s) => ({
      rolesByTeam: {
        ...s.rolesByTeam,
        [teamId]: (s.rolesByTeam[teamId] ?? []).filter((r) => r.id !== roleId),
      },
    }));
  },

  assignMemberRole: async (teamId, userId, roleId) => {
    await api.assignMemberRole(teamId, userId, roleId);
    set((s) => ({
      membersByTeam: {
        ...s.membersByTeam,
        [teamId]: (s.membersByTeam[teamId] ?? []).map((m) =>
          m.user_id === userId && !m.role_ids.includes(roleId)
            ? { ...m, role_ids: [...m.role_ids, roleId] }
            : m,
        ),
      },
    }));
  },

  removeMemberRole: async (teamId, userId, roleId) => {
    await api.removeMemberRole(teamId, userId, roleId);
    set((s) => ({
      membersByTeam: {
        ...s.membersByTeam,
        [teamId]: (s.membersByTeam[teamId] ?? []).map((m) =>
          m.user_id === userId
            ? { ...m, role_ids: m.role_ids.filter((rid) => rid !== roleId) }
            : m,
        ),
      },
    }));
  },

  setMemberName: async (teamId, userId, name) => {
    await api.setMemberName(teamId, userId, name);
    await get().loadMembers(teamId);
  },

  setMemberPermissions: async (teamId, userId, allow, deny) => {
    await api.setMemberPermissions(teamId, userId, allow, deny);
    set((s) => ({
      membersByTeam: {
        ...s.membersByTeam,
        [teamId]: (s.membersByTeam[teamId] ?? []).map((m) =>
          m.user_id === userId ? { ...m, permission_allow: allow, permission_deny: deny } : m,
        ),
      },
    }));
  },

  getActiveMembers: () => {
    const { activeTeamId, membersByTeam } = get();
    if (!activeTeamId) return [];
    return membersByTeam[activeTeamId] ?? [];
  },
  }),
);
