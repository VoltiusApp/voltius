import { create } from "zustand";
import type { PortForwardingRule, PortForwardingRuleFormData } from "@/types";
import * as api from "@/services/portForwardingRules";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { reportAuditMutation } from "@/services/auditMutations";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useTeamStore } from "@/stores/teamStore";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";

function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

function upsert(arr: PortForwardingRule[], item: PortForwardingRule): PortForwardingRule[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

function findTeamEntry(
  teamMap: Record<string, PortForwardingRule[]>,
  id: string,
): { teamId: string; rule: PortForwardingRule } | null {
  for (const [teamId, rules] of Object.entries(teamMap)) {
    const rule = rules.find((r) => r.id === id);
    if (rule) return { teamId, rule };
  }
  return null;
}

function toFormData(rule: PortForwardingRule, vaultId = rule.vault_id): PortForwardingRuleFormData {
  return {
    name: rule.name,
    local_port: rule.local_port,
    remote_port: rule.remote_port,
    remote_host: rule.remote_host,
    tunnel_type: rule.tunnel_type,
    bind_host: rule.bind_host,
    target_host: rule.target_host,
    description: rule.description,
    connection_ids: rule.connection_ids,
    folder_id: rule.folder_id,
    vault_id: vaultId,
  };
}

function clock(prev: PortForwardingRule, key: string): string {
  return prev.clocks[key] ?? prev.updated_at;
}

interface PortForwardingStore {
  rules: PortForwardingRule[];
  loading: boolean;
  teamRules: Record<string, PortForwardingRule[]>;
  loadRules: () => Promise<void>;
  setTeamRules: (teamId: string, items: PortForwardingRule[]) => void;
  clearTeamRules: (teamId?: string) => void;
  createRule: (data: PortForwardingRuleFormData) => Promise<PortForwardingRule>;
  updateRule: (id: string, data: PortForwardingRuleFormData) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  duplicateRule: (id: string) => Promise<PortForwardingRule>;
  moveRuleFolder: (id: string, folderId: string | null) => Promise<void>;
}

export const usePortForwardingStore = create<PortForwardingStore>((set, get) => ({
  rules: [],
  loading: false,
  teamRules: {},

  loadRules: async () => {
    set({ loading: true });
    const rules = await api.listPfRules();
    set({ rules, loading: false });
  },

  setTeamRules: (teamId, items) =>
    set((s) => ({ teamRules: { ...s.teamRules, [teamId]: items } })),

  clearTeamRules: (teamId) =>
    set((s) => {
      if (teamId === undefined) return { teamRules: {} };
      const next = { ...s.teamRules };
      delete next[teamId];
      return { teamRules: next };
    }),

  createRule: async (data) => {
    if (isTeamVaultId(data.vault_id)) {
      const now = new Date().toISOString();
      const rule: PortForwardingRule = {
        id: crypto.randomUUID(),
        name: data.name,
        local_port: data.local_port,
        remote_port: data.remote_port,
        remote_host: data.remote_host,
        tunnel_type: data.tunnel_type,
        bind_host: data.bind_host,
        target_host: data.target_host,
        description: data.description,
        connection_ids: data.connection_ids,
        folder_id: data.folder_id,
        vault_id: data.vault_id,
        created_at: now,
        updated_at: now,
        clocks: {
          name: now,
          local_port: now,
          remote_port: now,
          remote_host: now,
          tunnel_type: now,
          bind_host: now,
          target_host: now,
          description: now,
          connection_ids: now,
          folder_id: now,
          vault_id: now,
        },
      };
      const vaultId = data.vault_id;
      await saveTeamVaultObject(vaultId, "port_forwarding_rule", rule);
      set((s) => ({ teamRules: { ...s.teamRules, [vaultId]: upsert(s.teamRules[vaultId] ?? [], rule) } }));
      reportAuditMutation("port_forward", "created", { id: rule.id, name: rule.name, vault_id: rule.vault_id }, { tunnel_type: rule.tunnel_type });
      return rule;
    }

    const rule = await api.createPfRule(data);
    const rules = await api.listPfRules();
    set({ rules });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("port-forwarding-rule")) scheduleSync(); });
    reportAuditMutation("port_forward", "created", { id: rule.id, name: rule.name, vault_id: rule.vault_id }, { tunnel_type: rule.tunnel_type });
    return rule;
  },

  updateRule: async (id, data) => {
    const teamEntry = findTeamEntry(get().teamRules, id);
    if (teamEntry) {
      const { teamId, rule: prev } = teamEntry;
      if (!isTeamVaultId(data.vault_id)) {
        await api.createPfRule(data);
        await removeTeamVaultObject(teamId, id);
        set((s) => ({ teamRules: { ...s.teamRules, [teamId]: (s.teamRules[teamId] ?? []).filter((r) => r.id !== id) } }));
        const rules = await api.listPfRules();
        set({ rules });
        isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("port-forwarding-rule")) scheduleSync(); });
        return;
      }
      const now = new Date().toISOString();
      const nextTeamId = data.vault_id;
      const updated: PortForwardingRule = {
        ...prev,
        ...data,
        vault_id: nextTeamId,
        updated_at: now,
        deleted_at: undefined,
        clocks: {
          ...prev.clocks,
          name: prev.name !== data.name ? now : clock(prev, "name"),
          local_port: prev.local_port !== data.local_port ? now : clock(prev, "local_port"),
          remote_port: prev.remote_port !== data.remote_port ? now : clock(prev, "remote_port"),
          remote_host: prev.remote_host !== data.remote_host ? now : clock(prev, "remote_host"),
          tunnel_type: prev.tunnel_type !== data.tunnel_type ? now : clock(prev, "tunnel_type"),
          bind_host: prev.bind_host !== data.bind_host ? now : clock(prev, "bind_host"),
          target_host: prev.target_host !== data.target_host ? now : clock(prev, "target_host"),
          description: prev.description !== data.description ? now : clock(prev, "description"),
          connection_ids: JSON.stringify(prev.connection_ids) !== JSON.stringify(data.connection_ids) ? now : clock(prev, "connection_ids"),
          folder_id: prev.folder_id !== data.folder_id ? now : clock(prev, "folder_id"),
          vault_id: prev.vault_id !== nextTeamId ? now : clock(prev, "vault_id"),
        },
      };
      await saveTeamVaultObject(nextTeamId, "port_forwarding_rule", updated);
      if (nextTeamId !== teamId) await removeTeamVaultObject(teamId, id);
      set((s) => {
        const next = { ...s.teamRules };
        next[teamId] = (next[teamId] ?? []).filter((r) => r.id !== id);
        next[nextTeamId] = upsert(next[nextTeamId] ?? [], updated);
        return { teamRules: next };
      });
      reportAuditMutation("port_forward", "updated", { id: updated.id, name: updated.name, vault_id: updated.vault_id }, { tunnel_type: updated.tunnel_type });
      return;
    }

    if (isTeamVaultId(data.vault_id)) {
      await api.deletePfRule(id);
      const rule = await get().createRule(data);
      set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
      void rule;
      isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "port-forwarding-rule")) scheduleSync(); });
      return;
    }

    await api.updatePfRule(id, data);
    const rules = await api.listPfRules();
    set({ rules });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "port-forwarding-rule")) scheduleSync(); });
    reportAuditMutation("port_forward", "updated", { id, name: data.name, vault_id: data.vault_id }, { tunnel_type: data.tunnel_type });
  },

  deleteRule: async (id) => {
    const teamEntry = findTeamEntry(get().teamRules, id);
    if (teamEntry) {
      await removeTeamVaultObject(teamEntry.teamId, id);
      set((s) => ({ teamRules: { ...s.teamRules, [teamEntry.teamId]: (s.teamRules[teamEntry.teamId] ?? []).filter((r) => r.id !== id) } }));
      reportAuditMutation("port_forward", "deleted", { id: teamEntry.rule.id, name: teamEntry.rule.name, vault_id: teamEntry.rule.vault_id }, { tunnel_type: teamEntry.rule.tunnel_type });
      return;
    }

    const prev = get().rules.find((r) => r.id === id);
    await api.deletePfRule(id);
    const rules = await api.listPfRules();
    set({ rules });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "port-forwarding-rule")) scheduleSync(); });
    if (prev) reportAuditMutation("port_forward", "deleted", { id: prev.id, name: prev.name, vault_id: prev.vault_id }, { tunnel_type: prev.tunnel_type });
  },

  duplicateRule: async (id) => {
    const teamEntry = findTeamEntry(get().teamRules, id);
    if (teamEntry) {
      return get().createRule({ ...toFormData(teamEntry.rule), name: `${teamEntry.rule.name} (copy)` });
    }

    const rule = await api.duplicatePfRule(id);
    const rules = await api.listPfRules();
    set({ rules });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isTypeSynced("port-forwarding-rule")) scheduleSync(); });
    return rule;
  },

  moveRuleFolder: async (id, folderId) => {
    const teamEntry = findTeamEntry(get().teamRules, id);
    if (teamEntry) {
      await get().updateRule(id, { ...toFormData(teamEntry.rule), folder_id: folderId ?? undefined });
      return;
    }

    await api.movePfRuleFolder(id, folderId);
    const rules = await api.listPfRules();
    set({ rules });
    isServerMode().then((s) => { if (s && useSyncPrefsStore.getState().isObjectSynced(id, "port-forwarding-rule")) scheduleSync(); });
  },
}));
