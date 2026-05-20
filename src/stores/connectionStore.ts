import { create } from "zustand";
import type { Connection, ConnectionFormData, AuthType } from "@/types";
import * as api from "@/services/connections";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useTeamStore } from "@/stores/teamStore";
import { reportAuditMutation } from "@/services/auditMutations";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { classifyVaultTransition, migrateVaultObject } from "@/services/teamVaultMigration";
import { useTeamObjectPrefsStore } from "@/stores/teamObjectPrefsStore";

// ─── Team vault helpers ───────────────────────────────────────────────────────

function isTeamVaultId(vaultId: string | null | undefined): vaultId is string {
  if (!vaultId) return false;
  return useTeamStore.getState().teams.some((t) => t.id === vaultId);
}

function upsertConn(arr: Connection[], item: Connection): Connection[] {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const next = [...arr];
  next[idx] = item;
  return next;
}

function findTeamConn(
  teamMap: Record<string, Connection[]>,
  id: string,
): { teamId: string; conn: Connection } | null {
  for (const [teamId, conns] of Object.entries(teamMap)) {
    const conn = conns.find((c) => c.id === id);
    if (conn) return { teamId, conn };
  }
  return null;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ConnectionStore {
  connections: Connection[];
  loading: boolean;
  teamConnections: Record<string, Connection[]>;
  loadConnections: () => Promise<void>;
  setTeamConnections: (teamId: string, items: Connection[]) => void;
  clearTeamConnections: (teamId?: string) => void;
  saveConnection: (data: ConnectionFormData) => Promise<Connection>;
  updateConnection: (id: string, data: ConnectionFormData) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  setDistro: (id: string, distro: string) => Promise<void>;
  setLastUsed: (id: string) => Promise<void>;
  renameTag: (oldName: string, newName: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  pinConnection: (id: string, pinned: boolean | null) => Promise<void>;
  pinConnectionForTeam: (id: string, pinned: boolean) => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: [],
  loading: false,
  teamConnections: {},

  loadConnections: async () => {
    set({ loading: true });
    const connections = await api.listConnections();
    set({ connections, loading: false });
  },

  setTeamConnections: (teamId, items) =>
    set((s) => ({ teamConnections: { ...s.teamConnections, [teamId]: items } })),

  clearTeamConnections: (teamId) =>
    set((s) => {
      if (teamId === undefined) return { teamConnections: {} };
      const next = { ...s.teamConnections };
      delete next[teamId];
      return { teamConnections: next };
    }),

  saveConnection: async (data) => {
    if (isTeamVaultId(data.vault_id)) {
      const now = new Date().toISOString();
      const conn: Connection = {
        id: crypto.randomUUID(),
        name: data.name,
        host: data.host ?? "",
        port: data.port ?? 0,
        username: data.username ?? "",
        auth_type: data.auth_type ?? "password",
        tags: data.tags ?? [],
        identity_id: data.identity_id,
        key_id: data.key_id,
        folder_id: data.folder_id,
        vault_id: data.vault_id,
        jump_hosts: data.jump_hosts,
        env_vars: data.env_vars,
        agent_forwarding: data.agent_forwarding,
        pre_command: data.pre_command,
        post_command: data.post_command,
        terminal_encoding: data.terminal_encoding,
        distro: data.distro,
        icon: data.icon,
        pinned: data.pinned,
        ping_disabled: data.ping_disabled,
        connection_type: data.connection_type,
        serial_port: data.serial_port,
        serial_baud: data.serial_baud,
        serial_data_bits: data.serial_data_bits,
        serial_parity: data.serial_parity,
        serial_stop_bits: data.serial_stop_bits,
        serial_flow_control: data.serial_flow_control,
        created_at: now,
        updated_at: now,
        last_used_at: null,
        clocks: { created_at: now, updated_at: now },
      };
      const vaultId = data.vault_id!;
      await saveTeamVaultObject(vaultId, "connection", conn);
      set((s) => ({
        teamConnections: {
          ...s.teamConnections,
          [vaultId]: upsertConn(s.teamConnections[vaultId] ?? [], conn),
        },
      }));
      reportAuditMutation("connection", "created", { id: conn.id, name: conn.name ?? conn.host, vault_id: conn.vault_id });
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Created connection "${data.name ?? data.host}"`,
        undo: async () => {
          await useConnectionStore.getState().deleteConnection(recreatedId ?? conn.id);
          recreatedId = null;
        },
        redo: async () => {
          const r = await useConnectionStore.getState().saveConnection(data);
          recreatedId = r.id;
        },
      });
      return conn;
    }

    const conn = await api.saveConnection(data);
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("connection")) scheduleSync(); });
    reportAuditMutation("connection", "created", { id: conn.id, name: conn.name ?? conn.host, vault_id: conn.vault_id });
    let recreatedId: string | null = null;
    useHistoryStore.getState().push({
      label: `Created connection "${data.name ?? data.host}"`,
      undo: async () => {
        await useConnectionStore.getState().deleteConnection(recreatedId ?? conn.id);
        recreatedId = null;
      },
      redo: async () => {
        const r = await useConnectionStore.getState().saveConnection(data);
        recreatedId = r.id;
      },
    });
    return conn;
  },

  updateConnection: async (id, data) => {
    const teamEntry = findTeamConn(get().teamConnections, id);
    if (teamEntry) {
      const now = new Date().toISOString();
      const prev = teamEntry.conn;
      const updated: Connection = {
        ...prev,
        name: data.name,
        host: data.host ?? prev.host,
        port: data.port ?? prev.port,
        username: data.username ?? prev.username,
        auth_type: data.auth_type ?? prev.auth_type,
        tags: data.tags ?? prev.tags,
        identity_id: data.identity_id,
        key_id: data.key_id,
        folder_id: data.folder_id,
        vault_id: data.vault_id ?? prev.vault_id,
        jump_hosts: data.jump_hosts,
        env_vars: data.env_vars,
        agent_forwarding: data.agent_forwarding,
        pre_command: data.pre_command,
        post_command: data.post_command,
        terminal_encoding: data.terminal_encoding,
        distro: data.distro ?? prev.distro,
        icon: data.icon ?? prev.icon,
        pinned: data.pinned,
        connection_type: data.connection_type ?? prev.connection_type,
        serial_port: data.serial_port ?? prev.serial_port,
        serial_baud: data.serial_baud ?? prev.serial_baud,
        serial_data_bits: data.serial_data_bits ?? prev.serial_data_bits,
        serial_parity: data.serial_parity ?? prev.serial_parity,
        serial_stop_bits: data.serial_stop_bits ?? prev.serial_stop_bits,
        serial_flow_control: data.serial_flow_control ?? prev.serial_flow_control,
        ping_disabled: data.ping_disabled,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      const { teamId } = teamEntry;
      const migrated = await migrateVaultObject({
        previousVaultId: teamId,
        nextVaultId: updated.vault_id,
        isTeamVaultId,
        item: updated,
        updateLocal: () => api.updateConnection(id, data),
        saveTeam: (teamId, item) => saveTeamVaultObject(teamId, "connection", item),
        removeTeam: removeTeamVaultObject,
      });
      const transition = classifyVaultTransition(teamId, migrated.vault_id, isTeamVaultId);
      const connections = transition.kind === "team-to-local" ? await api.listConnections() : undefined;
      set((s) => {
        const teamConnections = { ...s.teamConnections };
        if (transition.kind === "team-to-team") {
          teamConnections[transition.sourceTeamId] = (teamConnections[transition.sourceTeamId] ?? []).filter((c) => c.id !== id);
          teamConnections[transition.destinationTeamId] = upsertConn(teamConnections[transition.destinationTeamId] ?? [], migrated);
          return { teamConnections };
        }
        if (transition.kind === "team-to-local") {
          teamConnections[transition.sourceTeamId] = (teamConnections[transition.sourceTeamId] ?? []).filter((c) => c.id !== id);
          return { connections, teamConnections };
        }
        teamConnections[teamId] = upsertConn(teamConnections[teamId] ?? [], migrated);
        return { teamConnections };
      });
      reportAuditMutation("connection", "updated", { id: updated.id, name: updated.name ?? updated.host, vault_id: updated.vault_id });
      const prevData: ConnectionFormData = {
        name: prev.name, host: prev.host, port: prev.port,
        username: prev.username, auth_type: prev.auth_type as AuthType,
        tags: prev.tags, identity_id: prev.identity_id, key_id: prev.key_id, folder_id: prev.folder_id,
        vault_id: prev.vault_id, jump_hosts: prev.jump_hosts, env_vars: prev.env_vars,
        agent_forwarding: prev.agent_forwarding, pre_command: prev.pre_command,
        post_command: prev.post_command, terminal_encoding: prev.terminal_encoding,
        distro: prev.distro, icon: prev.icon,
      };
      useHistoryStore.getState().push({
        label: `Updated connection "${prev.name ?? prev.host}"`,
        undo: async () => { await useConnectionStore.getState().updateConnection(id, prevData); },
        redo: async () => { await useConnectionStore.getState().updateConnection(id, data); },
      });
      return;
    }

    const prev = get().connections.find((c) => c.id === id);
    const now = new Date().toISOString();
    const item: Connection = prev
      ? {
          ...prev,
          name: data.name,
          host: data.host ?? prev.host,
          port: data.port ?? prev.port,
          username: data.username ?? prev.username,
          auth_type: data.auth_type ?? prev.auth_type,
          tags: data.tags ?? prev.tags,
          identity_id: data.identity_id,
          key_id: data.key_id,
          folder_id: data.folder_id,
          vault_id: data.vault_id ?? prev.vault_id,
          jump_hosts: data.jump_hosts,
          env_vars: data.env_vars,
          agent_forwarding: data.agent_forwarding,
          pre_command: data.pre_command,
          post_command: data.post_command,
          terminal_encoding: data.terminal_encoding,
          distro: data.distro ?? prev.distro,
          icon: data.icon ?? prev.icon,
          pinned: data.pinned,
          connection_type: data.connection_type ?? prev.connection_type,
          serial_port: data.serial_port ?? prev.serial_port,
          serial_baud: data.serial_baud ?? prev.serial_baud,
          serial_data_bits: data.serial_data_bits ?? prev.serial_data_bits,
          serial_parity: data.serial_parity ?? prev.serial_parity,
          serial_stop_bits: data.serial_stop_bits ?? prev.serial_stop_bits,
          serial_flow_control: data.serial_flow_control ?? prev.serial_flow_control,
          ping_disabled: data.ping_disabled,
          updated_at: now,
          clocks: { ...prev.clocks, updated_at: now },
        }
      : ({ id, vault_id: data.vault_id } as Connection);
    const updated = await migrateVaultObject({
      previousVaultId: prev?.vault_id,
      nextVaultId: data.vault_id ?? prev?.vault_id,
      isTeamVaultId,
      item,
      updateLocal: () => api.updateConnection(id, data),
      saveTeam: (teamId, item) => saveTeamVaultObject(teamId, "connection", item),
      removeTeam: removeTeamVaultObject,
    });
    const connections = await api.listConnections();
    const transition = classifyVaultTransition(prev?.vault_id, updated.vault_id, isTeamVaultId);
    set((s) => {
      if (transition.kind === "local-to-team") {
        return {
          connections,
          teamConnections: {
            ...s.teamConnections,
            [transition.destinationTeamId]: upsertConn(s.teamConnections[transition.destinationTeamId] ?? [], updated),
          },
        };
      }
      if (transition.kind === "team-to-team") {
        const teamConnections = { ...s.teamConnections };
        teamConnections[transition.sourceTeamId] = (teamConnections[transition.sourceTeamId] ?? []).filter((c) => c.id !== id);
        teamConnections[transition.destinationTeamId] = upsertConn(teamConnections[transition.destinationTeamId] ?? [], updated);
        return { connections, teamConnections };
      }
      if (transition.kind === "team-to-local") {
        return {
          connections,
          teamConnections: {
            ...s.teamConnections,
            [transition.sourceTeamId]: (s.teamConnections[transition.sourceTeamId] ?? []).filter((c) => c.id !== id),
          },
        };
      }
      if (isTeamVaultId(updated.vault_id)) {
        return {
          connections,
          teamConnections: {
            ...s.teamConnections,
            [updated.vault_id]: upsertConn(s.teamConnections[updated.vault_id] ?? [], updated),
          },
        };
      }
      return {
        connections,
      };
    });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
    if (prev) reportAuditMutation("connection", "updated", { id, name: data.name ?? prev.name ?? prev.host, vault_id: data.vault_id ?? prev.vault_id });
    if (prev) {
      const prevData: ConnectionFormData = {
        name: prev.name, host: prev.host, port: prev.port,
        username: prev.username, auth_type: prev.auth_type as AuthType,
        tags: prev.tags, identity_id: prev.identity_id, key_id: prev.key_id, folder_id: prev.folder_id,
        vault_id: prev.vault_id, jump_hosts: prev.jump_hosts, env_vars: prev.env_vars,
        agent_forwarding: prev.agent_forwarding, pre_command: prev.pre_command,
        post_command: prev.post_command, terminal_encoding: prev.terminal_encoding,
        distro: prev.distro, icon: prev.icon,
      };
      useHistoryStore.getState().push({
        label: `Updated connection "${prev.name ?? prev.host}"`,
        undo: async () => { await useConnectionStore.getState().updateConnection(id, prevData); },
        redo: async () => { await useConnectionStore.getState().updateConnection(id, data); },
      });
    }
  },

  deleteConnection: async (id) => {
    const teamEntry = findTeamConn(get().teamConnections, id);
    if (teamEntry) {
      const { teamId, conn: prev } = teamEntry;
      await removeTeamVaultObject(teamId, id);
      set((s) => ({
        teamConnections: {
          ...s.teamConnections,
          [teamId]: (s.teamConnections[teamId] ?? []).filter((c) => c.id !== id),
        },
      }));
      reportAuditMutation("connection", "deleted", { id: prev.id, name: prev.name ?? prev.host, vault_id: prev.vault_id });
      const prevData: ConnectionFormData = {
        name: prev.name, host: prev.host, port: prev.port,
        username: prev.username, auth_type: prev.auth_type as AuthType,
        tags: prev.tags, identity_id: prev.identity_id, key_id: prev.key_id, folder_id: prev.folder_id,
        vault_id: prev.vault_id, jump_hosts: prev.jump_hosts, env_vars: prev.env_vars,
        agent_forwarding: prev.agent_forwarding, pre_command: prev.pre_command,
        post_command: prev.post_command, terminal_encoding: prev.terminal_encoding,
        distro: prev.distro, icon: prev.icon,
      };
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted connection "${prev.name ?? prev.host}"`,
        undo: async () => {
          const r = await useConnectionStore.getState().saveConnection(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useConnectionStore.getState().deleteConnection(recreatedId ?? id);
          recreatedId = null;
        },
      });
      return;
    }

    const prev = get().connections.find((c) => c.id === id);
    await api.deleteConnection(id);
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
    if (prev) reportAuditMutation("connection", "deleted", { id: prev.id, name: prev.name ?? prev.host, vault_id: prev.vault_id });
    if (prev) {
      const prevData: ConnectionFormData = {
        name: prev.name, host: prev.host, port: prev.port,
        username: prev.username, auth_type: prev.auth_type as AuthType,
        tags: prev.tags, identity_id: prev.identity_id, key_id: prev.key_id, folder_id: prev.folder_id,
        vault_id: prev.vault_id, jump_hosts: prev.jump_hosts, env_vars: prev.env_vars,
        agent_forwarding: prev.agent_forwarding, pre_command: prev.pre_command,
        post_command: prev.post_command, terminal_encoding: prev.terminal_encoding,
        distro: prev.distro, icon: prev.icon,
      };
      let recreatedId: string | null = null;
      useHistoryStore.getState().push({
        label: `Deleted connection "${prev.name ?? prev.host}"`,
        undo: async () => {
          const r = await useConnectionStore.getState().saveConnection(prevData);
          recreatedId = r.id;
        },
        redo: async () => {
          await useConnectionStore.getState().deleteConnection(recreatedId ?? id);
          recreatedId = null;
        },
      });
    }
  },

  setDistro: async (id, distro) => {
    const teamEntry = findTeamConn(get().teamConnections, id);
    if (teamEntry) {
      const { teamId, conn: prev } = teamEntry;
      const now = new Date().toISOString();
      const updated: Connection = { ...prev, distro, updated_at: now, clocks: { ...prev.clocks, updated_at: now } };
      await saveTeamVaultObject(teamId, "connection", updated);
      set((s) => ({
        teamConnections: {
          ...s.teamConnections,
          [teamId]: upsertConn(s.teamConnections[teamId] ?? [], updated),
        },
      }));
      const prevDistro = prev.distro ?? "";
      useHistoryStore.getState().push({
        label: `Changed distro for "${prev.name ?? prev.host}"`,
        undo: async () => { await useConnectionStore.getState().setDistro(id, prevDistro); },
        redo: async () => { await useConnectionStore.getState().setDistro(id, distro); },
      });
      return;
    }

    const prev = get().connections.find((c) => c.id === id);
    await api.setConnectionDistro(id, distro);
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === id ? { ...c, distro } : c,
      ),
    }));
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
    if (prev) {
      const prevDistro = prev.distro ?? "";
      useHistoryStore.getState().push({
        label: `Changed distro for "${prev.name ?? prev.host}"`,
        undo: async () => { await useConnectionStore.getState().setDistro(id, prevDistro); },
        redo: async () => { await useConnectionStore.getState().setDistro(id, distro); },
      });
    }
  },

  setLastUsed: async (id) => {
    const now = new Date().toISOString();
    const teamEntry = findTeamConn(get().teamConnections, id);
    if (teamEntry) {
      const { teamId, conn: prev } = teamEntry;
      const updated = { ...prev, last_used_at: now };
      await saveTeamVaultObject(teamId, "connection", updated);
      set((s) => ({
        teamConnections: {
          ...s.teamConnections,
          [teamId]: upsertConn(s.teamConnections[teamId] ?? [], updated),
        },
      }));
      return;
    }

    await api.setConnectionLastUsed(id);
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === id ? { ...c, last_used_at: now } : c,
      ),
    }));
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
  },

  renameTag: async (oldName, newName) => {
    // Personal connections
    const toUpdate = get().connections.filter((c) => c.tags.includes(oldName));
    await Promise.all(
      toUpdate.map((c) =>
        api.updateConnection(c.id, {
          name: c.name, host: c.host, port: c.port, username: c.username,
          auth_type: c.auth_type as AuthType,
          tags: c.tags.map((t) => (t === oldName ? newName : t)),
          identity_id: c.identity_id, key_id: c.key_id, folder_id: c.folder_id,
        }),
      ),
    );
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("connection")) scheduleSync(); });

    // Team connections
    const now = new Date().toISOString();
    const updatedTeamMap: Record<string, Connection[]> = {};
    const affectedTeams = new Set<string>();
    for (const [teamId, conns] of Object.entries(get().teamConnections)) {
      const updated = conns.map((c) => {
        if (!c.tags.includes(oldName)) return c;
        affectedTeams.add(teamId);
        return { ...c, tags: c.tags.map((t) => (t === oldName ? newName : t)), updated_at: now };
      });
      updatedTeamMap[teamId] = updated;
    }
    if (affectedTeams.size > 0) {
      for (const teamId of affectedTeams) {
        await Promise.all((updatedTeamMap[teamId] ?? []).map((c) => saveTeamVaultObject(teamId, "connection", c)));
      }
      set({ teamConnections: updatedTeamMap });
    }

    useHistoryStore.getState().push({
      label: `Renamed tag "${oldName}" to "${newName}"`,
      undo: async () => { await useConnectionStore.getState().renameTag(newName, oldName); },
      redo: async () => { await useConnectionStore.getState().renameTag(oldName, newName); },
    });
  },

  deleteTag: async (name) => {
    // Personal connections
    const toUpdate = get().connections.filter((c) => c.tags.includes(name));
    const prevTagsById = new Map(toUpdate.map((c) => [c.id, c.tags]));
    await Promise.all(
      toUpdate.map((c) =>
        api.updateConnection(c.id, {
          name: c.name, host: c.host, port: c.port, username: c.username,
          auth_type: c.auth_type as AuthType,
          tags: c.tags.filter((t) => t !== name),
          identity_id: c.identity_id, key_id: c.key_id, folder_id: c.folder_id,
        }),
      ),
    );
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("connection")) scheduleSync(); });

    // Team connections
    const now = new Date().toISOString();
    const updatedTeamMap: Record<string, Connection[]> = {};
    const affectedTeams = new Set<string>();
    for (const [teamId, conns] of Object.entries(get().teamConnections)) {
      const updated = conns.map((c) => {
        if (!c.tags.includes(name)) return c;
        affectedTeams.add(teamId);
        return { ...c, tags: c.tags.filter((t) => t !== name), updated_at: now };
      });
      updatedTeamMap[teamId] = updated;
    }
    if (affectedTeams.size > 0) {
      for (const teamId of affectedTeams) {
        await Promise.all((updatedTeamMap[teamId] ?? []).map((c) => saveTeamVaultObject(teamId, "connection", c)));
      }
      set({ teamConnections: updatedTeamMap });
    }

    useHistoryStore.getState().push({
      label: `Deleted tag "${name}"`,
      undo: async () => {
        const store = useConnectionStore.getState();
        await Promise.all(
          [...prevTagsById.entries()].map(([connId, tags]) => {
            const conn = store.connections.find((c) => c.id === connId);
            if (!conn) return Promise.resolve();
            return store.updateConnection(connId, {
              name: conn.name, host: conn.host, port: conn.port,
              username: conn.username, auth_type: conn.auth_type as AuthType,
              tags, identity_id: conn.identity_id, key_id: conn.key_id, folder_id: conn.folder_id,
            });
          }),
        );
      },
      redo: async () => { await useConnectionStore.getState().deleteTag(name); },
    });
  },

  pinConnection: async (id, pinned) => {
    const teamEntry = findTeamConn(get().teamConnections, id);
    if (teamEntry) {
      await useTeamObjectPrefsStore.getState().setPinned(teamEntry.teamId, id, pinned);
      return;
    }

    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;
    const nextPinned = pinned ?? false;
    await api.updateConnection(id, {
      name: conn.name, host: conn.host, port: conn.port, username: conn.username,
      auth_type: conn.auth_type as AuthType, tags: conn.tags, identity_id: conn.identity_id, key_id: conn.key_id,
      folder_id: conn.folder_id, vault_id: conn.vault_id, jump_hosts: conn.jump_hosts,
      env_vars: conn.env_vars, agent_forwarding: conn.agent_forwarding,
      pre_command: conn.pre_command, post_command: conn.post_command,
      terminal_encoding: conn.terminal_encoding, distro: conn.distro, icon: conn.icon, pinned: nextPinned,
    });
    set((s) => ({ connections: s.connections.map((c) => c.id === id ? { ...c, pinned: nextPinned } : c) }));
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
  },

  pinConnectionForTeam: async (id, pinned) => {
    const teamEntry = findTeamConn(get().teamConnections, id);
    if (!teamEntry) return;
    const { teamId, conn: prev } = teamEntry;
    const now = new Date().toISOString();
    const updated: Connection = { ...prev, pinned, updated_at: now, clocks: { ...prev.clocks, updated_at: now } };
    await saveTeamVaultObject(teamId, "connection", updated);
    set((s) => ({
      teamConnections: {
        ...s.teamConnections,
        [teamId]: upsertConn(s.teamConnections[teamId] ?? [], updated),
      },
    }));
  },
}));
