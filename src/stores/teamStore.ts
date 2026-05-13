import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import * as api from "@/services/teamService";
import type { Team, TeamMember, TeamRole } from "@/services/teamService";
import { distributeKeyToNewMember } from "@/services/teamVaultSync";
import { useNotificationStore } from "@/stores/notificationStore";
export type { Team, TeamMember, TeamRole };

interface TeamStore {
  teams: Team[];
  membersByTeam: Record<string, TeamMember[]>;
  rolesByTeam: Record<string, TeamRole[]>;
  activeTeamId: string | null;
  loading: boolean;

  loadTeams: () => Promise<void>;
  createTeam: (name: string) => Promise<Team>;
  loadMembers: (teamId: string) => Promise<void>;
  addMember: (teamId: string, email: string, role?: string) => Promise<void>;
  addMemberById: (teamId: string, userId: string, role?: string) => Promise<void>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  setActiveTeam: (teamId: string | null) => void;
  getActiveMembers: () => TeamMember[];
  setMemberOnline: (userId: string, online: boolean) => void;
  // Roles
  loadRoles: (teamId: string) => Promise<void>;
  createRole: (teamId: string, name: string, permissions: number, color?: string) => Promise<TeamRole>;
  updateRole: (teamId: string, roleId: string, updates: { name?: string; permissions?: number; color?: string; position?: number }) => Promise<void>;
  deleteRole: (teamId: string, roleId: string) => Promise<void>;
  assignMemberRole: (teamId: string, userId: string, roleId: string) => Promise<void>;
  removeMemberRole: (teamId: string, userId: string, roleId: string) => Promise<void>;
}

export const useTeamStore = create<TeamStore>()(
  persist(
  (set, get) => ({
  teams: [],
  membersByTeam: {},
  rolesByTeam: {},
  activeTeamId: null,
  loading: false,

  loadTeams: async () => {
    set({ loading: true });
    try {
      const fresh = await api.listTeams();
      const prev = get().teams;
      const same =
        prev.length === fresh.length &&
        fresh.every((t, i) => t.id === prev[i].id && t.name === prev[i].name &&
          JSON.stringify(t.role_ids) === JSON.stringify(prev[i].role_ids));
      const teams = same ? prev : fresh;
      set({ teams, loading: false });
      if (teams.length > 0 && !get().activeTeamId) {
        set({ activeTeamId: teams[0].id });
      }
      // Persist team role_ids to keychain for Tauri backend reference
      const roleIds: Record<string, string[]> = {};
      for (const t of teams) roleIds[t.id] = t.role_ids;
      invoke("keychain_set", {
        key: "team_vault_roles",
        value: JSON.stringify(roleIds),
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
    const members = get().membersByTeam[teamId] ?? [];
    const newMember = members.find((m) => m.email === email);
    if (newMember?.public_key) {
      distributeKeyToNewMember(teamId, newMember.user_id, newMember.public_key).catch(() => {
        useNotificationStore.getState().addToast({
          pluginId: "system",
          pluginName: "Voltius",
          type: "toast",
          message: `Member added, but vault key sharing failed for ${newMember.email}. Try redistributing keys after they sign in again.`,
          severity: "warning",
          duration: 7000,
        });
      });
    } else if (newMember) {
      useNotificationStore.getState().addToast({
        pluginId: "system",
        pluginName: "Voltius",
        type: "toast",
        message: `${newMember.email} was added, but they need to sign in once before vault access can be encrypted for them.`,
        severity: "warning",
        duration: 7000,
      });
    }
  },

  addMemberById: async (teamId, userId, role) => {
    await api.addMemberById(teamId, userId, role);
    await get().loadMembers(teamId);
    const members = get().membersByTeam[teamId] ?? [];
    const newMember = members.find((m) => m.user_id === userId);
    if (newMember?.public_key) {
      distributeKeyToNewMember(teamId, newMember.user_id, newMember.public_key).catch(() => {
        useNotificationStore.getState().addToast({
          pluginId: "system",
          pluginName: "Voltius",
          type: "toast",
          message: `Member added, but vault key sharing failed for ${newMember.email}. Try redistributing keys after they sign in again.`,
          severity: "warning",
          duration: 7000,
        });
      });
    } else if (newMember) {
      useNotificationStore.getState().addToast({
        pluginId: "system",
        pluginName: "Voltius",
        type: "toast",
        message: `${newMember.email} was added, but they need to sign in once before vault access can be encrypted for them.`,
        severity: "warning",
        duration: 7000,
      });
    }
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

  getActiveMembers: () => {
    const { activeTeamId, membersByTeam } = get();
    if (!activeTeamId) return [];
    return membersByTeam[activeTeamId] ?? [];
  },
  }),
  {
    name: "voltius-teams",
    partialize: (state) => ({ teams: state.teams }),
  }
));
