import { invoke } from "@tauri-apps/api/core";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { sshSendInput } from "@/services/ssh";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useFolderStore } from "@/stores/folderStore";
import { getSyncState, onSyncStateChange, ENTITY_FILES, getExcludedObjectIds, type BlobPayload } from "@/services/sync";
import { useThemeStore } from "@/stores/themeStore";
import { mergeEntities, mergeSecrets } from "@/services/crdt";
import type {
  UISlot,
  ContributedAction,
  UIStatusBarContributionFactory,
  UIStatusBarSlot,
} from "@/plugins/api";
import * as connectionService from "@/services/connections";
import * as keyService from "@/services/keys";
import * as identityService from "@/services/identities";
import { storePluginSecret, getPluginSecret, deletePluginSecret, storeSecret, deleteSecret } from "@/services/vault";
import { appFetch } from "@/services/http";
import type {
  PluginAPI,
  PluginManifest,
  PluginRegisterFn,
  PluginConnection,
  PluginConnectionInput,
  PluginKey,
  PluginIdentity,
  PluginSession,
  PluginConfigField,
} from "./api";

// ─── Inter-plugin exposed APIs ────────────────────────────────────────────

const _exposedApis = new Map<string, unknown>();

// ─── Login-sync readiness gate ────────────────────────────────────────────
// Resolves immediately for local/offline users; SplashScreen holds it pending
// while syncOnLogin / syncOnLoginReplace runs so plugins don't race the merge.

let _loginSyncResolve: (() => void) | null = null;
let _loginSyncReady: Promise<void> = Promise.resolve();

export function setLoginSyncPending(): void {
  _loginSyncReady = new Promise<void>((resolve) => { _loginSyncResolve = resolve; });
}

export function resolveLoginSync(): void {
  _loginSyncResolve?.();
  _loginSyncResolve = null;
}

// ─── Per-plugin settings-change listeners ─────────────────────────────────

const _settingsListeners = new Map<string, Set<(key: string, value: unknown) => void>>();

// ─── Lifecycle (module-level, shared across all plugins) ──────────────────

interface SessionSnapshot {
  status: string;
  connectionId: string;
  connectionName: string;
  type: string;
}

function findConnection(connectionId: string) {
  const { connections, teamConnections } = useConnectionStore.getState();
  return (
    connections.find((c) => c.id === connectionId) ??
    Object.values(teamConnections).flat().find((c) => c.id === connectionId)
  );
}

const _onConnectionEstablished = new Set<(conn: PluginConnection) => void>();
const _onConnectionClosed = new Set<(conn: PluginConnection) => void>();
const _onSessionActivated = new Set<(session: PluginSession) => void>();
const _onBeforeQuit = new Set<() => void | Promise<void>>();
// sessions namespace listeners (separate from lifecycle so sessions:read permission can gate them)
const _onSessionConnected = new Set<(session: PluginSession) => void>();
const _onSessionDisconnected = new Set<(session: PluginSession) => void>();
const _onSessionTabActivated = new Set<(session: PluginSession) => void>();

let _lifecycleUnsubscribe: (() => void) | null = null;
let _quitHandlerRegistered = false;

function safeCall<T>(cb: (arg: T) => unknown, arg: T) {
  try { cb(arg); } catch (e) { console.warn("[plugin-runtime] lifecycle callback error", e); }
}

function ensureLifecycleSetup() {
  if (_lifecycleUnsubscribe) return;

  let prevSessions = new Map<string, SessionSnapshot>();
  let prevActiveId: string | null = null;

  _lifecycleUnsubscribe = useSessionStore.subscribe((state) => {
    const { sessions, activeSessionId } = state;
    const currentMap = new Map<string, SessionSnapshot>(
      sessions.map((s) => [s.id, {
        status: s.status,
        connectionId: s.connectionId,
        connectionName: s.connectionName,
        type: s.type,
      }]),
    );

    for (const [sid, snap] of currentMap) {
      const prev = prevSessions.get(sid);
      if (snap.status === "connected" && prev?.status !== "connected") {
        const conn = findConnection(snap.connectionId);
        if (conn) _onConnectionEstablished.forEach((cb) => safeCall(cb, conn as PluginConnection));
        const session: PluginSession = { id: sid, ...snap };
        _onSessionConnected.forEach((cb) => safeCall(cb, session));
      }
    }

    for (const [sid, snap] of prevSessions) {
      if (snap.status !== "connected") continue;
      const curr = currentMap.get(sid);
      if (!curr || curr.status === "disconnected") {
        const conn = findConnection(snap.connectionId);
        if (conn) _onConnectionClosed.forEach((cb) => safeCall(cb, conn as PluginConnection));
        const session: PluginSession = { id: sid, ...snap };
        _onSessionDisconnected.forEach((cb) => safeCall(cb, session));
      }
    }

    if (activeSessionId !== prevActiveId && activeSessionId) {
      const snap = currentMap.get(activeSessionId);
      if (snap) {
        const session: PluginSession = { id: activeSessionId, ...snap };
        _onSessionActivated.forEach((cb) => safeCall(cb, session));
        _onSessionTabActivated.forEach((cb) => safeCall(cb, session));
      }
    }

    prevSessions = currentMap;
    prevActiveId = activeSessionId;
  });
}

async function ensureQuitHandler() {
  if (_quitHandlerRegistered) return;
  _quitHandlerRegistered = true;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    const callbacks = [..._onBeforeQuit];
    await Promise.race([
      Promise.allSettled(callbacks.map((cb) => cb())),
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);
    // win.destroy() deadlocks on Windows (message pump waiting for handler
    // to return, handler waiting for destroy to be processed by message pump).
    // Use a Rust-side exit instead, which bypasses the JS/WebView2 layer.
    const { invoke } = await import("@tauri-apps/api/core");
    invoke("force_quit").catch(() => {});
  });
}

// ─── Plugin keybinding registry ───────────────────────────────────────────

interface PluginKeybinding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  execute: () => void;
}

const _pluginKeybindings = new Map<string, PluginKeybinding>(); // omni command id → binding
let _keybindHandlerInstalled = false;

function parseKeybinding(raw: string): Omit<PluginKeybinding, "execute"> | null {
  const parts = raw.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  if (!key) return null;
  const displayKey = key.length === 1 ? key.toUpperCase() : key;
  return {
    key: displayKey,
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    meta: parts.includes("meta"),
  };
}

function formatPluginKeybinding(kb: Omit<PluginKeybinding, "execute">): string {
  const parts: string[] = [];
  if (kb.ctrl) parts.push("Ctrl");
  if (kb.meta) parts.push("Meta");
  if (kb.shift) parts.push("Shift");
  parts.push(kb.key === " " ? "Space" : kb.key);
  return parts.join("+");
}

function ensureKeybindHandler() {
  if (_keybindHandlerInstalled) return;
  _keybindHandlerInstalled = true;
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey;
    const meta = e.metaKey;
    for (const kb of _pluginKeybindings.values()) {
      const ctrlMatch = kb.ctrl ? (ctrl || meta) : (!ctrl && !meta);
      const metaMatch = !kb.ctrl && kb.meta ? meta : true; // if ctrl already covered
      if (
        ctrlMatch && metaMatch &&
        e.shiftKey === kb.shift &&
        (e.key === kb.key || e.key.toUpperCase() === kb.key)
      ) {
        e.preventDefault();
        e.stopPropagation();
        kb.execute();
        return;
      }
    }
  }, true);
}

function registerKeybinding(commandId: string, raw: string, execute: () => void): string | null {
  const parsed = parseKeybinding(raw);
  if (!parsed) return null;

  for (const [existingId, kb] of _pluginKeybindings) {
    if (kb.key === parsed.key && kb.ctrl === parsed.ctrl && kb.shift === parsed.shift) {
      console.warn(`[plugin-runtime] Keybinding "${raw}" already registered by "${existingId}", ignoring "${commandId}"`);
      return null;
    }
  }

  ensureKeybindHandler();
  _pluginKeybindings.set(commandId, { ...parsed, execute });
  return formatPluginKeybinding(parsed);
}

// ─── Store reload map ─────────────────────────────────────────────────────

const RELOADABLE_STORES: Record<string, () => Promise<void>> = {
  connections: () => useConnectionStore.getState().loadConnections(),
  identities: () => useIdentityStore.getState().loadIdentities(),
  keys: () => useKeyStore.getState().loadKeys(),
  snippets: () => useSnippetStore.getState().loadSnippets(),
  folders: () => useFolderStore.getState().loadFolders(),
};

// ─── Settings schema validation ───────────────────────────────────────────

class PluginTypeError extends Error {
  constructor(key: string, expected: string, got: unknown) {
    super(`PluginTypeError: "${key}" expects ${expected}, got ${typeof got}`);
  }
}

function validateField(key: string, value: unknown, field: PluginConfigField) {
  switch (field.type) {
    case "string":
    case "select":
      if (typeof value !== "string") throw new PluginTypeError(key, "string", value);
      if (field.type === "select" && field.options && !field.options.includes(value as string)) {
        throw new Error(`PluginTypeError: "${key}" must be one of [${field.options.join(", ")}]`);
      }
      break;
    case "number":
      if (typeof value !== "number") throw new PluginTypeError(key, "number", value);
      break;
    case "boolean":
      if (typeof value !== "boolean") throw new PluginTypeError(key, "boolean", value);
      break;
  }
}

async function populateDefaults(pluginId: string, config: Record<string, PluginConfigField>) {
  for (const [key, field] of Object.entries(config)) {
    const existing = await storageGet(pluginId, key);
    if (existing === null) {
      await storageSet(pluginId, key, field.default);
    }
  }
}

// ─── Shared event bus ─────────────────────────────────────────────────────

const _eventHandlers = new Map<string, Set<(data: unknown) => void>>();

function busOn(event: string, handler: (data: unknown) => void): () => void {
  if (!_eventHandlers.has(event)) _eventHandlers.set(event, new Set());
  _eventHandlers.get(event)!.add(handler);
  return () => _eventHandlers.get(event)?.delete(handler);
}

function busEmit(pluginId: string, event: string, data?: unknown): void {
  const prefixed = `${pluginId}:${event}`;
  _eventHandlers.get(prefixed)?.forEach((h) => h(data));
  // also emit unprefixed for intra-plugin listeners
  _eventHandlers.get(event)?.forEach((h) => h(data));
}

// ─── Plugin storage (JSON in app data) ───────────────────────────────────

async function storageGet<T>(pluginId: string, key: string): Promise<T | null> {
  try {
    const raw = await invoke<string | null>("plugin_storage_get", { pluginId, key });
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function storageSet<T>(pluginId: string, key: string, value: T): Promise<void> {
  await invoke("plugin_storage_set", { pluginId, key, value: JSON.stringify(value) });
}

async function storageDelete(pluginId: string, key: string): Promise<void> {
  await invoke("plugin_storage_delete", { pluginId, key });
}

// ─── Permission checks ───────────────────────────────────────────────────

function requirePerm(manifest: PluginManifest, perm: string): void {
  if (!manifest.permissions.includes(perm)) {
    throw new Error(`Plugin "${manifest.id}" requires permission "${perm}"`);
  }
}

// ─── Scoped plugin API ────────────────────────────────────────────────────

function createPluginAPI(manifest: PluginManifest): PluginAPI {
  const id = manifest.id;
  const store = usePluginStore.getState;

  const api: PluginAPI = {
    pluginId: id,
    isActive: () => _registry.get(id)?.active ?? true,

    keys: {
      async list() {
        requirePerm(manifest, "keys:read");
        return keyService.listKeys() as Promise<PluginKey[]>;
      },
      async create(data, privateKey, publicKey) {
        requirePerm(manifest, "keys:write");
        const key = await keyService.saveKey({ name: data.name, key_type: data.key_type, tags: data.tags ?? [] });
        await storeSecret(`key:${key.id}:private`, privateKey);
        if (publicKey) await storeSecret(`key:${key.id}:public`, publicKey);
        return key as PluginKey;
      },
      async delete(keyId) {
        requirePerm(manifest, "keys:write");
        await deleteSecret(`key:${keyId}:private`).catch(() => {});
        await deleteSecret(`key:${keyId}:public`).catch(() => {});
        await keyService.deleteKey(keyId);
      },
    },

    identities: {
      async list() {
        requirePerm(manifest, "identities:read");
        return identityService.listIdentities() as Promise<PluginIdentity[]>;
      },
      async create(data) {
        requirePerm(manifest, "identities:write");
        return identityService.saveIdentity({ ...data, tags: data.tags ?? [] }) as Promise<PluginIdentity>;
      },
      async delete(identityId) {
        requirePerm(manifest, "identities:write");
        await identityService.deleteIdentity(identityId);
      },
    },

    connections: {
      async list() {
        requirePerm(manifest, "connections:read");
        return connectionService.listConnections() as Promise<PluginConnection[]>;
      },
      async get(connId) {
        requirePerm(manifest, "connections:read");
        const all = await connectionService.listConnections();
        return (all.find((c) => c.id === connId) as PluginConnection) ?? null;
      },
      async create(data: PluginConnectionInput) {
        requirePerm(manifest, "connections:write");
        const conn = await connectionService.saveConnection({
          name: data.name,
          host: data.host,
          port: data.port,
          username: data.username,
          auth_type: data.auth_type,
          tags: data.tags ?? [],
          identity_id: data.identity_id,
          jump_hosts: data.jump_hosts,
        });
        await useConnectionStore.getState().loadConnections();
        return conn as PluginConnection;
      },
      async update(connId, data) {
        requirePerm(manifest, "connections:write");
        const existing = await connectionService.listConnections();
        const conn = existing.find((c) => c.id === connId);
        if (!conn) throw new Error(`Connection ${connId} not found`);
        await connectionService.updateConnection(connId, {
          name: data.name ?? conn.name,
          host: data.host ?? conn.host,
          port: data.port ?? conn.port,
          username: data.username ?? conn.username,
          auth_type: data.auth_type ?? conn.auth_type,
          tags: data.tags ?? conn.tags,
          identity_id: data.identity_id ?? conn.identity_id,
          jump_hosts: data.jump_hosts !== undefined ? data.jump_hosts : conn.jump_hosts,
          notes: conn.notes, // plugins can't set notes; never wipe the user's
        });
        await useConnectionStore.getState().loadConnections();
      },
      async delete(connId) {
        requirePerm(manifest, "connections:write");
        await connectionService.deleteConnection(connId);
        await useConnectionStore.getState().loadConnections();
      },
      async bulkImport(items) {
        requirePerm(manifest, "connections:write");
        const results: PluginConnection[] = [];
        for (const item of items) {
          const conn = await connectionService.saveConnection({
            name: item.name,
            host: item.host,
            port: item.port,
            username: item.username,
            auth_type: item.auth_type,
            tags: item.tags ?? [],
          });
          results.push(conn as PluginConnection);
        }
        await useConnectionStore.getState().loadConnections();
        return results;
      },
      subscribe(cb) {
        requirePerm(manifest, "connections:read");
        return useConnectionStore.subscribe((s) => cb(s.connections as PluginConnection[]));
      },
    },

    vault: {
      async get(key) {
        requirePerm(manifest, "vault:read");
        return getPluginSecret(id, key);
      },
      async set(key, value) {
        requirePerm(manifest, "vault:write");
        await storePluginSecret(id, key, value);
      },
      async delete(key) {
        requirePerm(manifest, "vault:write");
        await deletePluginSecret(id, key);
      },
    },

    themes: {
      register(theme) {
        requirePerm(manifest, "themes");
        store().registerPluginTheme(theme);
      },
      unregister(themeId) {
        requirePerm(manifest, "themes");
        store().unregisterPluginTheme(themeId);
      },
    },

    omni: {
      register(command) {
        requirePerm(manifest, "omni-commands");
        let formattedKeybinding: string | null = null;
        if (command.keybinding) {
          formattedKeybinding = registerKeybinding(command.id, command.keybinding, () => {
            void command.execute();
          });
        }
        store().registerOmniCommand({ ...command, keybinding: formattedKeybinding ?? command.keybinding });
        return () => {
          store().unregisterOmniCommand(command.id);
          _pluginKeybindings.delete(command.id);
        };
      },
      unregister(cmdId) {
        requirePerm(manifest, "omni-commands");
        store().unregisterOmniCommand(cmdId);
        _pluginKeybindings.delete(cmdId);
      },
    },

    ui: {
      registerSettingsPage(page) {
        requirePerm(manifest, "settings-page");
        // Ensure page ID is prefixed with plugin ID so unregisterAll and store filters work correctly
        const prefixed = { ...page, id: page.id.startsWith(id) ? page.id : `${id}:${page.id}` };
        store().registerSettingsPage(prefixed);
        return () => store().unregisterSettingsPage(prefixed.id);
      },
      registerSidebarItem(item) {
        requirePerm(manifest, "sidebar-item");
        store().registerSidebarItem(item);
        return () => store().unregisterSidebarItem(item.id);
      },
      registerRightPanelSection(section) {
        requirePerm(manifest, "right-panel");
        store().registerRightPanelSection(section);
        return () => store().unregisterRightPanelSection(section.id);
      },
      registerContextMenuItem(item) {
        requirePerm(manifest, "context-menu");
        store().registerContextMenuItem(item);
        return () => store().unregisterContextMenuItem(item.id);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerContribution(slot: UISlot, fn: (ctx: any) => ContributedAction[]) {
        requirePerm(manifest, "ui-contributions");
        return useUIContributionStore.getState().registerContribution(id, slot, fn);
      },
      registerStatusBarItem(slot: UIStatusBarSlot, fn: UIStatusBarContributionFactory) {
        requirePerm(manifest, "ui-contributions");
        return useUIContributionStore.getState().registerStatusBarContribution(id, slot, fn);
      },
      unregister(itemId) {
        const s = store();
        s.unregisterOmniCommand(itemId);
        s.unregisterSettingsPage(itemId);
        s.unregisterSidebarItem(itemId);
        s.unregisterRightPanelSection(itemId);
        s.unregisterContextMenuItem(itemId);
      },
    },

    storage: {
      get: (key) => storageGet(id, key),
      async set(key, value) {
        const field = manifest.contributes?.configuration?.[key];
        if (field) validateField(key, value, field);
        await storageSet(id, key, value);
        _settingsListeners.get(id)?.forEach((cb) => { try { cb(key, value); } catch {} });
      },
      delete: (key) => storageDelete(id, key),
    },

    http: {
      async get<T>(url: string, opts?: RequestInit) {
        requirePerm(manifest, "http");
        const res = await appFetch(url, { ...opts, method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        return res.json() as Promise<T>;
      },
      async post<T>(url: string, body: unknown, opts?: RequestInit) {
        requirePerm(manifest, "http");
        const res = await appFetch(url, {
          ...opts,
          method: "POST",
          headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        return res.json() as Promise<T>;
      },
    },

    fs: {
      async readText(path) {
        requirePerm(manifest, "fs");
        return invoke<string>("fs_read_text_home", { path });
      },
      async writeText(path, content) {
        requirePerm(manifest, "fs");
        await invoke("fs_write_text_home", { path, content });
      },
      async exists(path) {
        requirePerm(manifest, "fs");
        return invoke<boolean>("fs_exists_home", { path });
      },
      watch(path, cb, opts) {
        requirePerm(manifest, "fs");
        const intervalMs = opts?.intervalMs ?? 5000;
        let lastContent: string | null = null;
        const tick = async () => {
          try {
            const content = await invoke<string>("fs_read_text_home", { path });
            if (lastContent !== null && content !== lastContent) cb();
            lastContent = content;
          } catch {
            // File might not exist yet — ignore
          }
        };
        // Initial read to establish baseline (no callback on first tick)
        void tick();
        const id = setInterval(() => void tick(), intervalMs);
        return () => clearInterval(id);
      },
    },

    events: {
      on: (event, handler) => busOn(event, handler),
      emit: (event, data) => busEmit(id, event, data),
    },

    notifications: {
      toast(message, opts = {}) {
        requirePerm(manifest, "notifications");
        const { severity = "info", duration = 2500, action } = opts;
        const pluginName = manifest.name.slice(0, 20);
        useNotificationStore.getState().addToast({
          pluginId: id, pluginName, type: "toast",
          message, severity, duration, action,
        });
      },

      progress(title, opts = {}) {
        requirePerm(manifest, "notifications");
        const { indeterminate = true, cancellable = false } = opts;
        const pluginName = manifest.name.slice(0, 20);
        let onCancel: (() => void) | undefined;

        const toastId = useNotificationStore.getState().addToast({
          pluginId: id, pluginName, type: "progress",
          message: title, severity: "info", duration: 0,
          progress: indeterminate ? undefined : 0,
          cancellable,
          onCancel: () => onCancel?.(),
          timedOutAt: Date.now() + 5 * 60 * 1000,
        });

        return {
          update(value, msg) {
            useNotificationStore.getState().updateToast(toastId, {
              progress: value, ...(msg && { message: msg }),
            });
          },
          finish(msg) {
            useNotificationStore.getState().updateToast(toastId, {
              finished: true, finishedSeverity: "success",
              ...(msg && { message: msg }),
            });
          },
          error(msg) {
            useNotificationStore.getState().updateToast(toastId, {
              finished: true, finishedSeverity: "error", message: msg, duration: 0,
            });
          },
          cancel() {
            onCancel?.();
            useNotificationStore.getState().dismissToast(toastId);
          },
        };
      },

      banner(message, opts = {}) {
        requirePerm(manifest, "notifications");
        const { severity = "info", actions = [], dismissable = true, flashToast = true } = opts;
        const pluginName = manifest.name.slice(0, 20);
        const notifStore = useNotificationStore.getState();
        const bannerId = notifStore.addBanner({
          pluginId: id, pluginName, message, severity, actions, dismissable,
        });
        if (flashToast) {
          notifStore.addToast({
            pluginId: id, pluginName, type: "toast",
            message, severity, duration: 2000,
          });
        }
        return {
          dismiss() { useNotificationStore.getState().dismissBanner(bannerId); },
          update(msg) { useNotificationStore.getState().updateBanner(bannerId, { message: msg }); },
        };
      },
    },

    log: {
      info: (msg, ...args) => console.info(`[plugin:${id}]`, msg, ...args),
      warn: (msg, ...args) => console.warn(`[plugin:${id}]`, msg, ...args),
      error: (msg, ...args) => console.error(`[plugin:${id}]`, msg, ...args),
    },

    sessions: {
      list() {
        requirePerm(manifest, "sessions:read");
        return useSessionStore.getState().sessions.map((s) => ({
          id: s.id,
          connectionId: s.connectionId,
          connectionName: s.connectionName,
          status: s.status,
          type: s.type,
        }));
      },
      onConnected(cb) {
        requirePerm(manifest, "sessions:read");
        ensureLifecycleSetup();
        _onSessionConnected.add(cb);
        return () => _onSessionConnected.delete(cb);
      },
      onDisconnected(cb) {
        requirePerm(manifest, "sessions:read");
        ensureLifecycleSetup();
        _onSessionDisconnected.add(cb);
        return () => _onSessionDisconnected.delete(cb);
      },
      onActivated(cb) {
        requirePerm(manifest, "sessions:read");
        ensureLifecycleSetup();
        _onSessionTabActivated.add(cb);
        return () => _onSessionTabActivated.delete(cb);
      },
      async sendCommand(sessionId, cmd) {
        requirePerm(manifest, "sessions:write");
        const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (!session) throw new Error(`Session "${sessionId}" not found`);
        if (session.type === "local") {
          const { invoke } = await import("@tauri-apps/api/core");
          const encoded = new TextEncoder().encode(cmd + "\n");
          await invoke("local_send_input", { sessionId, data: Array.from(encoded) });
        } else {
          const encoded = new TextEncoder().encode(cmd + "\n");
          await sshSendInput(sessionId, encoded);
        }
      },
    },

    lifecycle: {
      onConnectionEstablished(cb) {
        ensureLifecycleSetup();
        _onConnectionEstablished.add(cb);
        return () => _onConnectionEstablished.delete(cb);
      },
      onConnectionClosed(cb) {
        ensureLifecycleSetup();
        _onConnectionClosed.add(cb);
        return () => _onConnectionClosed.delete(cb);
      },
      onSessionActivated(cb) {
        ensureLifecycleSetup();
        _onSessionActivated.add(cb);
        return () => _onSessionActivated.delete(cb);
      },
      onSettingsChanged(cb) {
        if (!_settingsListeners.has(id)) _settingsListeners.set(id, new Set());
        _settingsListeners.get(id)!.add(cb);
        return () => _settingsListeners.get(id)?.delete(cb);
      },
      onBeforeQuit(cb) {
        void ensureQuitHandler();
        _onBeforeQuit.add(cb);
        return () => _onBeforeQuit.delete(cb);
      },
      waitForLoginSync: () => _loginSyncReady,
    },

    sync: {
      async getBlob(key) {
        requirePerm(manifest, "sync:read");
        const raw = await storageGet<string>(id, `__sync__${key}`);
        if (!raw) return null;
        const binary = atob(raw);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      },
      async setBlob(key, data) {
        requirePerm(manifest, "sync:write");
        if (data.length > 1024 * 1024) throw new Error("PluginStorageError: blob exceeds 1MB limit");
        // Chunked to avoid blocking the main thread on large payloads
        const CHUNK = 8192;
        let binary = "";
        for (let i = 0; i < data.length; i += CHUNK) {
          binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
        }
        await storageSet(id, `__sync__${key}`, btoa(binary));
      },
      onRemoteChange(key, cb) {
        requirePerm(manifest, "sync:read");
        let lastKnownRaw: string | null | undefined;
        storageGet<string>(id, `__sync__${key}`).then((v) => { lastKnownRaw = v; }).catch(() => {});

        const unsub = onSyncStateChange(async () => {
          if (getSyncState().status !== "success") return;
          try {
            const current = await storageGet<string>(id, `__sync__${key}`);
            if (current !== lastKnownRaw) {
              lastKnownRaw = current;
              if (current) {
                const binary = atob(current);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                cb(bytes);
              }
            }
          } catch {}
        });
        return unsub;
      },
      async triggerReload(storeKey) {
        requirePerm(manifest, "sync:read");
        const reload = RELOADABLE_STORES[storeKey];
        if (reload) {
          await reload();
        } else {
          console.warn(`[plugin:${id}] triggerReload: unknown store key "${storeKey}"`);
        }
      },

      async exportState(encKey, deviceId) {
        requirePerm(manifest, "sync:write");
        const encKeyBytes = Array.from(new Uint8Array(encKey.match(/.{2}/g)!.map((b) => parseInt(b, 16))));
        const blob: number[] = await invoke("backup_export", {
          encKey: encKeyBytes,
          accountId: "gist-sync",
          deviceId,
          // Strip cloud-off objects (and their secrets) from third-party sync
          // destinations too, mirroring the built-in server push (issue #47).
          excludedIds: getExcludedObjectIds(),
        });
        const CHUNK = 8192;
        let binary = "";
        const bytes = new Uint8Array(blob);
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        return btoa(binary);
      },

      async importStates(encKey, blobs) {
        requirePerm(manifest, "sync:write");
        let { files: mergedFiles, secrets: mergedSecrets, secret_clocks: mergedSecretClocks } =
          await invoke<BlobPayload>("state_export_raw");
        mergedSecretClocks ??= {};

        const parse = (s: string) => {
          try { return JSON.parse(s ?? "[]"); } catch { return []; }
        };

        let bestThemeRaw: string | null = null;
        let bestThemeUpdatedAt: string | null = null;

        for (const b64 of blobs) {
          const blobBytes: number[] = Array.from(
            Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
          );
          const encKeyBytes = Array.from(new Uint8Array(encKey.match(/.{2}/g)!.map((b) => parseInt(b, 16))));
          const remote = await invoke<BlobPayload>("backup_decrypt", {
            encKey: encKeyBytes,
            blob: blobBytes,
          });
          const newFiles: Record<string, string> = {};
          for (const file of ENTITY_FILES) {
            newFiles[file] = JSON.stringify(
              mergeEntities(parse(mergedFiles[file]), parse(remote.files[file] ?? "[]")),
            );
          }
          // Per-secret LWW merge: freshest write across devices wins (issue #35).
          const secretMerge = mergeSecrets(
            mergedSecrets,
            mergedSecretClocks,
            remote.secrets,
            remote.secret_clocks ?? {},
          );
          mergedSecrets = secretMerge.secrets;
          mergedSecretClocks = secretMerge.clocks;
          mergedFiles = newFiles;

          const themeRaw = remote.files["theme.json"];
          if (themeRaw) {
            try {
              const { updatedAt } = JSON.parse(themeRaw) as { updatedAt?: string };
              if (updatedAt && (!bestThemeUpdatedAt || updatedAt > bestThemeUpdatedAt)) {
                bestThemeUpdatedAt = updatedAt;
                bestThemeRaw = themeRaw;
              }
            } catch {}
          }
        }

        if (bestThemeRaw) {
          try {
            const localRaw = await invoke<string | null>("theme_load");
            let apply = true;
            if (localRaw) {
              const { updatedAt: localTs } = JSON.parse(localRaw) as { updatedAt?: string };
              if (localTs && localTs >= bestThemeUpdatedAt!) apply = false;
            }
            if (apply) {
              await invoke("theme_save", { state: bestThemeRaw });
              await useThemeStore.getState().loadFromDisk();
            }
          } catch {}
        }

        await invoke("state_import", { files: mergedFiles, secrets: mergedSecrets, secretClocks: mergedSecretClocks });
        for (const reload of Object.values(RELOADABLE_STORES)) {
          await reload();
        }
      },
    },

    plugins: {
      expose(publicApi) {
        _exposedApis.set(id, publicApi);
      },
      getApi(pluginId) {
        return _exposedApis.get(pluginId) ?? null;
      },
    },
  };

  return api;
}

// ─── Registry ─────────────────────────────────────────────────────────────

interface PluginEntry {
  manifest: PluginManifest;
  register: PluginRegisterFn;
  cleanup: (() => void) | void;
  active: boolean;
  api: ReturnType<typeof createPluginAPI>;
}

const _registry = new Map<string, PluginEntry>();

export function loadPlugin(manifest: PluginManifest, register: PluginRegisterFn, active = true): void {
  if (_registry.has(manifest.id)) {
    console.warn(`[plugin-runtime] Plugin "${manifest.id}" already loaded — skipping`);
    return;
  }
  const api = createPluginAPI(manifest);
  if (manifest.contributes?.configuration) {
    void populateDefaults(manifest.id, manifest.contributes.configuration);
  }
  const entry: PluginEntry = { manifest, register, cleanup: undefined, active, api };
  _registry.set(manifest.id, entry);
  entry.cleanup = register(api);
  console.info(`[plugin-runtime] Loaded plugin "${manifest.id}" v${manifest.version} (active=${active})`);
}

/**
 * Toggle a plugin's active state without fully unloading it.
 * Tears down the plugin's contributions via its cleanup, then re-runs register()
 * only when activating — so a disabled plugin's UI (right-panel sections, hooks,
 * etc.) actually stays gone. Plugins that need certain contributions to survive
 * while disabled (e.g. a settings page) register those imperatively and leave them
 * out of their cleanup; register() re-fires on activation with isActive() === true.
 */
export function setPluginActive(pluginId: string, active: boolean): void {
  const entry = _registry.get(pluginId);
  if (!entry) return;
  entry.cleanup?.();
  entry.cleanup = undefined;
  entry.active = active;
  if (active) {
    entry.cleanup = entry.register(entry.api);
  } else {
    useNotificationStore.getState().dismissAllForPlugin(pluginId);
  }
  console.info(`[plugin-runtime] Plugin "${pluginId}" set active=${active}`);
}

export function unloadPlugin(pluginId: string): void {
  const entry = _registry.get(pluginId);
  if (!entry) return;
  entry.cleanup?.();
  usePluginStore.getState().unregisterAll(pluginId);
  useUIContributionStore.getState().unregisterPlugin(pluginId);
  useNotificationStore.getState().dismissAllForPlugin(pluginId);
  _exposedApis.delete(pluginId);
  _settingsListeners.delete(pluginId);
  _registry.delete(pluginId);
  console.info(`[plugin-runtime] Unloaded plugin "${pluginId}"`);
}

export function unloadAll(): void {
  for (const id of _registry.keys()) unloadPlugin(id);
}

export function getLoadedPlugins(): PluginManifest[] {
  return [..._registry.values()].map((e) => e.manifest);
}

/** Read a plugin's storage value — for use by trusted UI code (e.g. auto-generated settings). */
export function pluginStorageGet<T>(pluginId: string, key: string): Promise<T | null> {
  return storageGet<T>(pluginId, key);
}

/** Write a plugin's storage value — for use by trusted UI code (e.g. auto-generated settings). */
export function pluginStorageSet<T>(pluginId: string, key: string, value: T): Promise<void> {
  return storageSet<T>(pluginId, key, value);
}
