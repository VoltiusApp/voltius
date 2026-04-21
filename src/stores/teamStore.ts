import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import * as api from "@/services/teamService";
import type { CustomRole, Team, TeamMember } from "@/services/teamService";
import { distributeKeyToNewMember } from "@/services/teamVaultSync";
export type { CustomRole, Team, TeamMember };

interface TeamStore {
  teams: Team[];
  membersByTeam: Record<string, TeamMember[]>;
  customRolesByTeam: Record<string, CustomRole[]>;
  activeTeamId: string | null;
  loading: boolean;

  loadTeams: () => Promise<void>;
  createTeam: (name: string) => Promise<Team>;
  loadMembers: (teamId: string) => Promise<void>;
  addMember: (teamId: string, email: string, role?: string) => Promise<void>;
  addMemberById: (teamId: string, userId: string, role?: string) => Promise<void>;
  updateMemberRole: (teamId: string, userId: string, role: string) => Promise<void>;
  assignCustomRole: (teamId: string, userId: string, customRoleId: string) => Promise<void>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  setActiveTeam: (teamId: string | null) => void;
  getActiveMembers: () => TeamMember[];
  // Custom roles
  loadCustomRoles: (teamId: string) => Promise<void>;
  createCustomRole: (teamId: string, name: string, permissions: number) => Promise<CustomRole>;
  updateCustomRole: (teamId: string, roleId: string, updates: { name?: string; permissions?: number }) => Promise<void>;
  deleteCustomRole: (teamId: string, roleId: string) => Promise<void>;
}

export const useTeamStore = create<TeamStore>()(
  persist(
  (set, get) => ({
  teams: [],
  membersByTeam: {},
  customRolesByTeam: {},
  activeTeamId: null,
  loading: false,

  loadTeams: async () => {
    set({ loading: true });
    try {
      const fresh = await api.listTeams();
      // Reuse previous reference when content is unchanged to prevent
      // infinite render loops in hooks that depend on `teams` identity.
      const prev = get().teams;
      const same =
        prev.length === fresh.length &&
        fresh.every((t, i) => t.id === prev[i].id && t.role === prev[i].role && t.name === prev[i].name);
      const teams = same ? prev : fresh;
      set({ teams, loading: false });
      if (teams.length > 0 && !get().activeTeamId) {
        set({ activeTeamId: teams[0].id });
      }
      // Persist {teamId: role} to keychain so the Rust backend can enforce permissions
      // even when the frontend permission checks are bypassed.
      const roles: Record<string, string> = {};
      for (const t of teams) roles[t.id] = t.role;
      invoke("keychain_set", {
        key: "team_vault_roles",
        value: JSON.stringify(roles),
      }).catch(() => {});
    } catch {
      set({ loading: false });
    }
  },

  createTeam: async (name) => {
    const team = await api.createTeam(name);
    set((s) => ({ teams: [...s.teams, team], activeTeamId: team.id }));
    return team;
  },

  loadMembers: async (teamId) => {
    const members = await api.listMembers(teamId);
    set((s) => ({ membersByTeam: { ...s.membersByTeam, [teamId]: members } }));
  },

  addMember: async (teamId, email, role) => {
    await api.addMember(teamId, email, role);
    await get().loadMembers(teamId);
    // Distribute team vault key to the newly added member
    const members = get().membersByTeam[teamId] ?? [];
    const newMember = members.find((m) => m.email === email);
    if (newMember?.public_key) {
      distributeKeyToNewMember(teamId, newMember.user_id, newMember.public_key).catch(() => {});
    }
  },

  addMemberById: async (teamId, userId, role) => {
    await api.addMemberById(teamId, userId, role);
    await get().loadMembers(teamId);
    // Distribute team vault key to the newly added member
    const members = get().membersByTeam[teamId] ?? [];
    const newMember = members.find((m) => m.user_id === userId);
    if (newMember?.public_key) {
      distributeKeyToNewMember(teamId, newMember.user_id, newMember.public_key).catch(() => {});
    }
  },

  updateMemberRole: async (teamId, userId, role) => {
    await api.updateMemberRole(teamId, userId, role);
    set((s) => ({
      membersByTeam: {
        ...s.membersByTeam,
        [teamId]: (s.membersByTeam[teamId] ?? []).map((m) =>
          m.user_id === userId ? { ...m, role, custom_role_id: null, custom_role_name: null, custom_role_permissions: null } : m,
        ),
      },
    }));
  },

  assignCustomRole: async (teamId, userId, customRoleId) => {
    await api.assignCustomRole(teamId, userId, customRoleId);
    // Reload members to get updated custom role info
    const members = await api.listMembers(teamId);
    set((s) => ({ membersByTeam: { ...s.membersByTeam, [teamId]: members } }));
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

  loadCustomRoles: async (teamId) => {
    const roles = await api.listCustomRoles(teamId);
    set((s) => ({ customRolesByTeam: { ...s.customRolesByTeam, [teamId]: roles } }));
  },

  createCustomRole: async (teamId, name, permissions) => {
    const role = await api.createCustomRole(teamId, name, permissions);
    set((s) => ({
      customRolesByTeam: {
        ...s.customRolesByTeam,
        [teamId]: [...(s.customRolesByTeam[teamId] ?? []), role],
      },
    }));
    return role;
  },

  updateCustomRole: async (teamId, roleId, updates) => {
    await api.updateCustomRole(teamId, roleId, updates);
    set((s) => ({
      customRolesByTeam: {
        ...s.customRolesByTeam,
        [teamId]: (s.customRolesByTeam[teamId] ?? []).map((r) =>
          r.id === roleId ? { ...r, ...updates } : r,
        ),
      },
    }));
  },

  deleteCustomRole: async (teamId, roleId) => {
    await api.deleteCustomRole(teamId, roleId);
    set((s) => ({
      customRolesByTeam: {
        ...s.customRolesByTeam,
        [teamId]: (s.customRolesByTeam[teamId] ?? []).filter((r) => r.id !== roleId),
      },
    }));
  },

  getActiveMembers: () => {
    const { activeTeamId, membersByTeam } = get();
    if (!activeTeamId) return [];
    return membersByTeam[activeTeamId] ?? [];
  },
  }),
  {
    name: "voltius-teams",
    // Only persist the teams list (roles). membersByTeam is too large and volatile.
    partialize: (state) => ({ teams: state.teams }),
  }
));
