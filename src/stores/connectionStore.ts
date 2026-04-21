import { create } from "zustand";
import type { Connection, ConnectionFormData, AuthType } from "@/types";
import * as api from "@/services/connections";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";

interface ConnectionStore {
  connections: Connection[];
  loading: boolean;
  loadConnections: () => Promise<void>;
  saveConnection: (data: ConnectionFormData) => Promise<Connection>;
  updateConnection: (id: string, data: ConnectionFormData) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  setDistro: (id: string, distro: string) => Promise<void>;
  setLastUsed: (id: string) => Promise<void>;
  renameTag: (oldName: string, newName: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  pinConnection: (id: string, pinned: boolean) => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: [],
  loading: false,

  loadConnections: async () => {
    set({ loading: true });
    const connections = await api.listConnections();
    set({ connections, loading: false });
  },

  saveConnection: async (data) => {
    const conn = await api.saveConnection(data);
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("connection")) scheduleSync(); });
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
    const prev = get().connections.find((c) => c.id === id);
    await api.updateConnection(id, data);
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
    if (prev) {
      const prevData: ConnectionFormData = {
        name: prev.name,
        host: prev.host,
        port: prev.port,
        username: prev.username,
        auth_type: prev.auth_type as AuthType,
        tags: prev.tags,
        identity_id: prev.identity_id,
        folder_id: prev.folder_id,
        vault_id: prev.vault_id,
        jump_hosts: prev.jump_hosts,
        env_vars: prev.env_vars,
        agent_forwarding: prev.agent_forwarding,
        pre_command: prev.pre_command,
        post_command: prev.post_command,
        terminal_encoding: prev.terminal_encoding,
      };
      useHistoryStore.getState().push({
        label: `Updated connection "${prev.name ?? prev.host}"`,
        undo: async () => { await useConnectionStore.getState().updateConnection(id, prevData); },
        redo: async () => { await useConnectionStore.getState().updateConnection(id, data); },
      });
    }
  },

  deleteConnection: async (id) => {
    const prev = get().connections.find((c) => c.id === id);
    await api.deleteConnection(id);
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
    if (prev) {
      const prevData: ConnectionFormData = {
        name: prev.name,
        host: prev.host,
        port: prev.port,
        username: prev.username,
        auth_type: prev.auth_type as AuthType,
        tags: prev.tags,
        identity_id: prev.identity_id,
        folder_id: prev.folder_id,
        vault_id: prev.vault_id,
        jump_hosts: prev.jump_hosts,
        env_vars: prev.env_vars,
        agent_forwarding: prev.agent_forwarding,
        pre_command: prev.pre_command,
        post_command: prev.post_command,
        terminal_encoding: prev.terminal_encoding,
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
    const toUpdate = get().connections.filter((c) => c.tags.includes(oldName));
    await Promise.all(
      toUpdate.map((c) =>
        api.updateConnection(c.id, {
          name: c.name,
          host: c.host,
          port: c.port,
          username: c.username,
          auth_type: c.auth_type as AuthType,
          tags: c.tags.map((t) => (t === oldName ? newName : t)),
          identity_id: c.identity_id,
          folder_id: c.folder_id,
        }),
      ),
    );
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("connection")) scheduleSync(); });
    useHistoryStore.getState().push({
      label: `Renamed tag "${oldName}" to "${newName}"`,
      undo: async () => { await useConnectionStore.getState().renameTag(newName, oldName); },
      redo: async () => { await useConnectionStore.getState().renameTag(oldName, newName); },
    });
  },

  deleteTag: async (name) => {
    const toUpdate = get().connections.filter((c) => c.tags.includes(name));
    const prevTagsById = new Map(toUpdate.map((c) => [c.id, c.tags]));
    await Promise.all(
      toUpdate.map((c) =>
        api.updateConnection(c.id, {
          name: c.name,
          host: c.host,
          port: c.port,
          username: c.username,
          auth_type: c.auth_type as AuthType,
          tags: c.tags.filter((t) => t !== name),
          identity_id: c.identity_id,
          folder_id: c.folder_id,
        }),
      ),
    );
    const connections = await api.listConnections();
    set({ connections });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("connection")) scheduleSync(); });
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
              tags, identity_id: conn.identity_id, folder_id: conn.folder_id,
            });
          }),
        );
      },
      redo: async () => { await useConnectionStore.getState().deleteTag(name); },
    });
  },

  pinConnection: async (id, pinned) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return;
    await api.updateConnection(id, {
      name: conn.name, host: conn.host, port: conn.port, username: conn.username,
      auth_type: conn.auth_type as AuthType, tags: conn.tags, identity_id: conn.identity_id,
      folder_id: conn.folder_id, vault_id: conn.vault_id, jump_hosts: conn.jump_hosts,
      env_vars: conn.env_vars, agent_forwarding: conn.agent_forwarding,
      pre_command: conn.pre_command, post_command: conn.post_command, terminal_encoding: conn.terminal_encoding,
      pinned,
    });
    set((s) => ({ connections: s.connections.map((c) => c.id === id ? { ...c, pinned } : c) }));
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "connection")) scheduleSync(); });
  },
}));
