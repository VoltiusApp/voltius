import { invoke } from "@tauri-apps/api/core";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { sshSendInput, onSshOutput } from "@/services/ssh";
import { onLocalOutput, localConnect, localSendInput } from "@/services/local";
import { onSerialOutput, serialWrite } from "@/services/serial";
import { readTerminalSnapshot, readTerminalSelection } from "@/hooks/useTerminal";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore, type NavItem } from "@/stores/uiStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import type { MobileScreen as MobileNavScreen } from "@/stores/mobileNavCore";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
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
import { sseFetch } from "@/services/sseFetch";
import { registerLxcExecSession } from "@/services/proxmox";
import { PLUGIN_AUDIT_ACTIONS } from "@/services/auditContext";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportPluginAuditEvent } from "@/services/auditReporter";
import { fetchLocalAuditLogs } from "@/services/localAuditService";
import { registerContributions, clearContributions } from "@/mcp/contributions";
import type { AuditLog } from "@/services/auditService";
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
  StreamKind,
  PluginMobileNavEntry,
  GlobalPanelHandle,
  PluginAuditRow,
} from "./api";
import { createStreamsAPI } from "./domains/streams";
import { createMetricsAPI } from "./domains/metrics";
import { createProcessesAPI } from "./domains/processes";
import { createCryptoAPI } from "./domains/crypto";
import { createI18nAPI } from "./domains/i18n";
import { createProxmoxAPI } from "./domains/proxmox";
import { createSftpAPI } from "./domains/sftp";
import { createDockerAPI } from "./domains/docker";
import { createVaultsAPI, type VaultPorts } from "./domains/vaults";
import { createFoldersAPI, type FolderPorts } from "./domains/folders";
import { createObjectsAPI, type ObjectPorts } from "./domains/objects";
import { resolveCan, type Permission } from "@/services/permissions";
import { getMyUserId } from "@/services/teamService";
import { fetchTeamData } from "@/services/teamVaultSync";
import { injectPluginStyle, removePluginStyle } from "./importPluginModule";
import { assertValidPluginId, isValidPluginId } from "./pluginId";

const STREAM_PERM: Record<StreamKind, string> = {
  metrics: "metrics:read",
  processes: "processes:read",
  "docker-logs": "docker:read",
  "docker-stack-logs": "docker:read",
};

// ─── Inter-plugin exposed APIs ────────────────────────────────────────────

const _exposedApis = new Map<string, unknown>();

// Per-plugin SFTP/FTP handles, so unloading a plugin closes the connections it
// opened. Without this a disabled plugin's sockets outlive it silently.
const _sftpDisposers = new Map<string, () => void>();

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
  localShell?: string;
}

function findConnection(connectionId: string) {
  const { connections, teamConnections } = useConnectionStore.getState();
  return (
    connections.find((c) => c.id === connectionId) ??
    Object.values(teamConnections).flat().find((c) => c.id === connectionId)
  );
}

/** In-memory team connections, keyed off the teams the user is actually in so a
 * stale cache for a team they left cannot resurface. Mirrors `useAllConnections`. */
function teamConnectionList() {
  const { teamConnections } = useConnectionStore.getState();
  return useTeamStore.getState().teams.flatMap((t) => teamConnections[t.id] ?? []);
}

/**
 * Personal + team connections, the single list every plugin-facing read
 * resolves against.
 *
 * The tool surface's connection guard and `deriveScope` both resolve ids
 * through `connections.list()`, so a team connection missing here is not a
 * display bug: the guard rejects its id and no grant can be minted for it,
 * which made team hosts unaddressable (#77). `team` is the authoritative flag —
 * a *personal* connection can also carry a `vault_id` (a local, non-team
 * vault), so the presence of one says nothing about ownership.
 */
async function listAllConnections(): Promise<PluginConnection[]> {
  const merged = new Map<string, PluginConnection>();
  for (const c of await connectionService.listConnections()) {
    merged.set(c.id, c as PluginConnection);
  }
  for (const c of teamConnectionList()) {
    merged.set(c.id, { ...(c as PluginConnection), team: true });
  }
  return [...merged.values()];
}

/** Team connections are owned by a team vault, not the personal store that
 * `connectionService` writes to. Sending one through that path would write to a
 * record the server never sees, so plugin writes fail loudly instead. */
function refuseTeamWrite(connectionId: string, verb: string) {
  if (teamConnectionList().some((c) => c.id === connectionId)) {
    throw new Error(`Connection ${connectionId} belongs to a team vault and cannot be ${verb} by a plugin`);
  }
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
        localShell: s.localShell,
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
  // win.destroy() deadlocks on Windows (message pump waiting for handler
  // to return, handler waiting for destroy to be processed by message pump).
  // Use a Rust-side exit instead, which bypasses the JS/WebView2 layer.
  const quit = () => { invoke("force_quit").catch(() => {}); };
  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    const callbacks = [..._onBeforeQuit];
    if (callbacks.length === 0) {
      quit();
      return;
    }
    // Without this the window stays up for the whole wait, which reads as a
    // hang when a quit hook does network work (gist-sync pushes on exit).
    win.hide().catch(() => {});
    // A hidden window over a live process is worse than a slow close, so the
    // exit is armed up front: it survives a throw or an invoke that never lands.
    const fallback = setTimeout(quit, 6000);
    try {
      await Promise.race([
        Promise.allSettled(callbacks.map(async (cb) => cb())),
        new Promise<void>((r) => setTimeout(r, 5000)),
      ]);
    } finally {
      clearTimeout(fallback);
      quit();
    }
  });
}

// ─── Plugin keybinding registry ───────────────────────────────────────────

interface PluginKeybinding {
  pluginId: string;
  key: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  execute: () => void;
}

const _pluginKeybindings = new Map<string, PluginKeybinding>(); // omni command id → binding

/**
 * pluginId → every contribution id that plugin has registered — the authorization
 * record for the id-taking unregister verbs, which otherwise take a bare id into a
 * single global namespace. A ledger rather than an id-prefix test because omni
 * commands are stored unprefixed, so `startsWith(pluginId + ":")` would reject a
 * plugin's own command.
 */
const _contributedIds = new Map<string, Set<string>>();

function trackContribution(pluginId: string, itemId: string): void {
  let ids = _contributedIds.get(pluginId);
  if (!ids) _contributedIds.set(pluginId, (ids = new Set()));
  ids.add(itemId);
}

/** Whether `itemId` was registered by `pluginId`. */
function ownsContribution(pluginId: string, itemId: string): boolean {
  return _contributedIds.get(pluginId)?.has(itemId) ?? false;
}

/**
 * Remove every keybinding a plugin has registered, keyed by pluginId rather than
 * relying on each command's individual disposer having run. Used by every teardown
 * path (register()-throw rollback, unloadPlugin, setPluginActive(false)) so a
 * keybinding can never outlive the plugin that registered it — including when
 * register() throws partway through and its aggregated cleanup was never produced.
 */
function clearPluginKeybindings(pluginId: string): void {
  for (const [commandId, kb] of _pluginKeybindings) {
    if (kb.pluginId === pluginId) _pluginKeybindings.delete(commandId);
  }
}

let _keybindHandlerInstalled = false;

/**
 * Panel id → the docked width that panel last reserved. dockedPanelWidth is one
 * global slot, not per-panel, so a release only zeroes it while the current value
 * is still the one this panel put there.
 */
const _dockedPanelWidths = new Map<string, { pluginId: string; width: number }>();

function releaseDockedWidth(panelId: string): void {
  const reserved = _dockedPanelWidths.get(panelId);
  if (!reserved) return;
  _dockedPanelWidths.delete(panelId);
  const ui = useUIStore.getState();
  if (reserved.width !== 0 && ui.dockedPanelWidth === reserved.width) ui.setDockedPanelWidth(0);
}

/**
 * Release every docked width a plugin reserved. Keyed by pluginId rather than
 * relying on each panel handle's disposer having run: the plugin's own cleanup is
 * whatever register() returned, so an unloaded plugin would otherwise leave the
 * shell permanently reserving a blank gutter with no panel in it.
 */
function clearPluginDockedWidths(pluginId: string): void {
  for (const [panelId, reserved] of _dockedPanelWidths) {
    if (reserved.pluginId === pluginId) releaseDockedWidth(panelId);
  }
}

function parseKeybinding(raw: string): Omit<PluginKeybinding, "execute" | "pluginId"> | null {
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

function formatPluginKeybinding(kb: Omit<PluginKeybinding, "execute" | "pluginId">): string {
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

function registerKeybinding(pluginId: string, commandId: string, raw: string, execute: () => void): string | null {
  const parsed = parseKeybinding(raw);
  if (!parsed) return null;

  for (const [existingId, kb] of _pluginKeybindings) {
    if (kb.key === parsed.key && kb.ctrl === parsed.ctrl && kb.shift === parsed.shift) {
      console.warn(`[plugin-runtime] Keybinding "${raw}" already registered by "${existingId}", ignoring "${commandId}"`);
      return null;
    }
  }

  ensureKeybindHandler();
  _pluginKeybindings.set(commandId, { ...parsed, execute, pluginId });
  return formatPluginKeybinding(parsed);
}

// ─── Vault ports ──────────────────────────────────────────────────────────

/**
 * A vault is team-backed when a team carries its id — the same test
 * folderStore makes. `teamId` on the record only survives a session that set
 * it, so the team list is the authority.
 */
const isTeamVaultId = (vaultId: string): boolean =>
  useTeamStore.getState().teams.some((t) => t.id === vaultId);

/**
 * Loads the seven stores the vault-object tabs read.
 *
 * Snippets, port-forwarding rules, keys, identities and snippet folders are
 * loaded by their own pages, so in a session that never opened them the stores
 * are empty — and an empty read is what turns "refuse a non-empty vault" into
 * silently orphaning its contents, and a paste's cascade into leaving a key
 * behind. The Vaults settings page loads the same seven for the same reason.
 */
const hydrateVaultObjectStores = async (): Promise<void> => {
  await Promise.all([
    useConnectionStore.getState().loadConnections(),
    useIdentityStore.getState().loadIdentities(),
    useKeyStore.getState().loadKeys(),
    useFolderStore.getState().loadFolders(),
    useSnippetStore.getState().loadSnippets(),
    useSnippetFolderStore.getState().loadFolders(),
    usePortForwardingStore.getState().loadRules(),
  ]);
};

const vaultPorts: VaultPorts = {
  vaults: {
    list: () => useVaultStore.getState().vaults,
    add: (name) => useVaultStore.getState().addVault(name),
    rename: (id, name) => useVaultStore.getState().renameVault(id, name),
    remove: (id) => useVaultStore.getState().removeVault(id),
  },
  isTeamVault: isTeamVaultId,
  /** Hydrates before counting — see `hydrateVaultObjectStores`. */
  contents: async () => {
    await hydrateVaultObjectStores();
    return {
      connections: useConnectionStore.getState().connections,
      keys: useKeyStore.getState().keys,
      identities: useIdentityStore.getState().identities,
      snippets: useSnippetStore.getState().snippets,
      portForwardingRules: usePortForwardingStore.getState().rules,
      folders: useFolderStore.getState().folders,
      snippetFolders: useSnippetFolderStore.getState().folders,
    };
  },
  remove: {
    connection: (id) => useConnectionStore.getState().deleteConnection(id),
    key: (id) => useKeyStore.getState().deleteKey(id),
    identity: (id) => useIdentityStore.getState().deleteIdentity(id),
    snippet: (id) => useSnippetStore.getState().deleteSnippet(id),
    portForwardingRule: (id) => usePortForwardingStore.getState().deleteRule(id),
    // Cascade off: the vault sweep deletes every object in the vault itself, so
    // a cascading folder delete would race it on ids already gone.
    folder: (id) => useFolderStore.getState().deleteFolder(id, { cascade: false }),
    snippetFolder: (id) => useSnippetFolderStore.getState().deleteFolder(id),
  },
};

/**
 * Both folder stores keep team folders in a separate map keyed by team id, so a
 * plain `folders` read would miss them and `list()` would claim a team vault has
 * none. Reads span both; the write verbs refuse a team vault anyway.
 */
const folderPorts: FolderPorts = {
  general: {
    list: () => {
      const s = useFolderStore.getState();
      return [...s.folders, ...Object.values(s.teamFolders).flat()];
    },
    save: (data) => useFolderStore.getState().saveFolder(data),
    update: (folderId, data) => useFolderStore.getState().updateFolder(folderId, data),
    remove: (folderId, cascade) => useFolderStore.getState().deleteFolder(folderId, { cascade }),
  },
  snippet: {
    list: () => {
      const s = useSnippetFolderStore.getState();
      return [...s.folders, ...Object.values(s.teamSnippetFolders).flat()];
    },
    save: (data) => useSnippetFolderStore.getState().saveFolder(data),
    update: (folderId, data) => useSnippetFolderStore.getState().updateFolder(folderId, data),
    remove: (folderId) => useSnippetFolderStore.getState().deleteFolder(folderId),
  },
  isTeamVault: isTeamVaultId,
  vaultExists: (vaultId) =>
    useVaultStore.getState().vaults.some((v) => v.id === vaultId) || isTeamVaultId(vaultId),
};

// ─── Object ports ─────────────────────────────────────────────────────────

/**
 * `can` is synchronous, so the user id it resolves against is read once by
 * `hydrate` — which every objects verb runs before anything else — rather than
 * awaited inside the permission check. Empty means "not signed in", and
 * `resolveCan` is pessimistic about team vaults in that state.
 */
let _myUserId = "";

const objectPorts: ObjectPorts = {
  hydrate: async () => {
    await hydrateVaultObjectStores();
    _myUserId = (await getMyUserId().catch(() => null)) ?? "";
    // Team roles and members decide `can` for a team-vault source; unloaded, the
    // pessimistic branch refuses a move the user is actually allowed to make.
    const team = useTeamStore.getState();
    await team.loadTeams().catch(() => {});
    await Promise.all(
      useTeamStore.getState().teams.flatMap((t) => [
        team.loadMembers(t.id).catch(() => {}),
        team.loadRoles(t.id).catch(() => {}),
        // The team maps every object read spans are filled by fetchTeamData
        // alone, which the UI drives. Without this a session that never opened
        // a team vault reports its objects as "not found" — and, worse, cannot
        // see a team-vault key a personal host points at, so a cross-vault move
        // completes with no cascade and no dangling refusal.
        fetchTeamData(t.id, { background: true }).catch(() => {}),
      ]),
    );
  },
  can: (permission, vaultId) => {
    const { teams, membersByTeam, rolesByTeam } = useTeamStore.getState();
    return resolveCan(
      { myUserId: _myUserId, teams, membersByTeam, rolesByTeam, vaults: useVaultStore.getState().vaults },
      permission as Permission,
      vaultId,
    );
  },
  isTeamVault: isTeamVaultId,
  vaults: () => {
    const vaults = useVaultStore.getState().vaults;
    const linked = new Set(vaults.map((v) => v.teamId).filter(Boolean));
    return [
      { id: "personal", name: "Personal" },
      ...vaults.filter((v) => v.id !== "personal").map((v) => ({ id: v.teamId ?? v.id, name: v.name })),
      ...useTeamStore.getState().teams.filter((t) => !linked.has(t.id)).map((t) => ({ id: t.id, name: t.name })),
    ];
  },
  /**
   * Every vault the user has, not the page's current filter: there is no view
   * here, so nothing is off-screen. Only `rootVaultIds` reads this, to tell a
   * root paste that silently dropped an object from one that was a no-op.
   */
  accessibleVaultIds: () => [
    "personal",
    ...useVaultStore.getState().vaults.map((v) => v.id),
    ...useTeamStore.getState().teams.map((t) => t.id),
  ],

  // Reads span the team maps too: both folder stores and every object store keep
  // team-vault records separately, and a tab that cannot see them reports a
  // team object as "not found" — or, worse, as an empty folder subtree.
  connections: () => [...useConnectionStore.getState().connections, ...teamConnectionList()],
  keys: () => {
    const s = useKeyStore.getState();
    return [...s.keys, ...Object.values(s.teamKeys).flat()];
  },
  identities: () => {
    const s = useIdentityStore.getState();
    return [...s.identities, ...Object.values(s.teamIdentities).flat()];
  },
  snippets: () => {
    const s = useSnippetStore.getState();
    return [...s.snippets, ...Object.values(s.teamSnippets).flat()];
  },
  rules: () => {
    const s = usePortForwardingStore.getState();
    return [...s.rules, ...Object.values(s.teamRules).flat()];
  },
  folders: () => {
    const s = useFolderStore.getState();
    return [...s.folders, ...Object.values(s.teamFolders).flat()];
  },
  snippetFolders: () => {
    const s = useSnippetFolderStore.getState();
    return [...s.folders, ...Object.values(s.teamSnippetFolders).flat()];
  },

  saveConnection: (form) => useConnectionStore.getState().saveConnection(form),
  updateConnection: (id, form) => useConnectionStore.getState().updateConnection(id, form),
  deleteConnection: (id) => useConnectionStore.getState().deleteConnection(id),
  loadConnections: () => useConnectionStore.getState().loadConnections(),

  saveKey: (form) => useKeyStore.getState().saveKey(form),
  updateKey: (id, form) => useKeyStore.getState().updateKey(id, form),
  deleteKey: (id) => useKeyStore.getState().deleteKey(id),
  loadKeys: () => useKeyStore.getState().loadKeys(),

  saveIdentity: (form) => useIdentityStore.getState().saveIdentity(form),
  updateIdentity: (id, form) => useIdentityStore.getState().updateIdentity(id, form),
  deleteIdentity: (id) => useIdentityStore.getState().deleteIdentity(id),
  loadIdentities: () => useIdentityStore.getState().loadIdentities(),

  createSnippet: (form) => useSnippetStore.getState().createSnippet(form),
  updateSnippet: (id, form) => useSnippetStore.getState().updateSnippet(id, form),
  deleteSnippet: (id) => useSnippetStore.getState().deleteSnippet(id),

  createRule: (form) => usePortForwardingStore.getState().createRule(form),
  updateRule: (id, form) => usePortForwardingStore.getState().updateRule(id, form),
  deleteRule: (id) => usePortForwardingStore.getState().deleteRule(id),
  moveRuleFolder: (id, folderId) => usePortForwardingStore.getState().moveRuleFolder(id, folderId),

  moveObjectsToFolder: (ids, objectType, folderId) =>
    useFolderStore.getState().moveObjectsToFolder(ids, objectType, folderId),
  saveFolder: (data) => useFolderStore.getState().saveFolder(data),
  updateFolder: (id, data) => useFolderStore.getState().updateFolder(id, data),
  // Cascading: a folder the paste moved out of the tab is empty, and a folder
  // whose contents the paste did not carry keeps them.
  deleteFolder: (id) => useFolderStore.getState().deleteFolder(id),
  moveFolder: (id, parentFolderId) => useFolderStore.getState().moveFolder(id, parentFolderId),
  saveSnippetFolder: (data) => useSnippetFolderStore.getState().saveFolder(data),
  updateSnippetFolder: (id, data) => useSnippetFolderStore.getState().updateFolder(id, data),
  deleteSnippetFolder: (id) => useSnippetFolderStore.getState().deleteFolder(id),
  moveSnippetFolder: (id, parentFolderId) =>
    useSnippetFolderStore.getState().moveFolder(id, parentFolderId),
};

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

// ─── Mobile nav-stack translation ─────────────────────────────────────────
// Translates a plugin's PluginMobileNavEntry into mobileNavCore's real stack
// shape ("panel-<kind>", plus that variant's exact fields). No `default` case
// and no `any`: tsc statically proves the switch covers every member of
// PluginMobileNavEntry's kind (it errors "not all code paths return a value"
// otherwise), and each case's return literal is structurally checked against
// MobileNavScreen. Growing PluginMobileNavEntry to a second kind without a
// matching case here, or with a case whose shape doesn't match a real
// MobileNavScreen variant, fails `tsc` — not silently at runtime the way the
// previous `as any` cast did.

export function toMobileNavScreen(entry: PluginMobileNavEntry): MobileNavScreen {
  switch (entry.kind) {
    case "docker-logs":
      return {
        kind: "panel-docker-logs",
        sessionId: entry.sessionId,
        containerId: entry.containerId,
        containerName: entry.containerName,
      };
  }
}

// ─── Permission checks ───────────────────────────────────────────────────

function requirePerm(manifest: PluginManifest, perm: string): void {
  if (!manifest.permissions.includes(perm)) {
    throw new Error(`Plugin "${manifest.id}" requires permission "${perm}"`);
  }
}

/**
 * Metadata keys that reach the local sink through `localMetadata`, which is
 * defined as never leaving the device: `command` (run_command's shell text) and
 * `args` (makeFileOp's stringified arguments, i.e. every path touched), plus the
 * markers boundLocalMetadata adds for them. api.audit.query is a second wire, so
 * they are stripped here too.
 */
const LOCAL_ONLY_METADATA_KEYS = [
  "command",
  "command_truncated",
  "args",
  "args_truncated",
  "localMetadata_dropped",
];

function projectAuditMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) return metadata;
  const out = { ...metadata };
  for (const key of LOCAL_ONLY_METADATA_KEYS) delete out[key];
  return out;
}

const toPluginAuditRow = (l: AuditLog): PluginAuditRow => ({
  action: l.action,
  actor_name: l.actor_name,
  source: l.source,
  target_type: l.target_type,
  target_id: l.target_id,
  target_name: l.target_name,
  metadata: projectAuditMetadata(l.metadata),
  created_at: l.created_at,
});

// ─── Scoped plugin API ────────────────────────────────────────────────────

/** Ids belonging to host APIs rather than plugins. See `whileActive`. */
const _hostApiIds = new Set<string>();

function createPluginAPI(manifest: PluginManifest): PluginAPI {
  const id = manifest.id;
  const store = usePluginStore.getState;

  // Gated permissions are honored for any plugin whose manifest declares the perm.
  // The consent gate lives upstream at install (describePermissions + the danger
  // consent dialog); this only verifies the manifest declared it. Kept as a named
  // seam so a future catastrophic tier can re-add a provenance wall here.
  const requireGated = (perm: string): void => {
    requirePerm(manifest, perm);
  };

  /** Gated per kind, not wholesale: a plugin allowed to file snippets has no
   *  business moving the user's keys. See objectPermissionsFor for the set. */
  const requireEachGated = (perms: string[]): void => {
    for (const perm of perms) requireGated(perm);
  };

  // Reserved prefix "plugin:<id>:" namespaces keychain keys per plugin. The id
  // is percent-encoded so a plugin id containing the ":" delimiter (e.g. "foo:x")
  // cannot forge a prefix that collides with another plugin's namespace.
  const kcKey = (key: string): string => `plugin:${encodeURIComponent(id)}:${key}`;

  // Teardown is one-shot, so an async continuation would re-publish after it. False
  // for an unloaded plugin too, since its registry entry is gone. Not applied to
  // ui.register* — those are meant to outlive a disable.
  //
  // A host API has no registry entry and never will, so the registry lookup would
  // reject every call it makes; it lives as long as the page, like `isActive`'s
  // own `?? true` already assumes.
  const whileActive = (verb: string): boolean => {
    if (_hostApiIds.has(id)) return true;
    if (_registry.get(id)?.active) return true;
    console.warn(`[plugin-runtime] "${id}" called ${verb} while disabled or unloaded — ignoring`);
    return false;
  };

  const streamsApi = createStreamsAPI();
  const metricsApi = createMetricsAPI(streamsApi);
  const processesApi = createProcessesAPI(streamsApi);
  const cryptoApi = createCryptoAPI();
  const i18nApi = createI18nAPI();
  const proxmoxApi = createProxmoxAPI();
  const sftpApi = createSftpAPI(findConnection);
  _sftpDisposers.set(id, () => sftpApi.dispose());
  const dockerApi = createDockerAPI(streamsApi);
  const vaultsApi = createVaultsAPI(vaultPorts);
  const foldersApi = createFoldersAPI(folderPorts);
  const objectsApi = createObjectsAPI(objectPorts);

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
        return listAllConnections();
      },
      async get(connId) {
        requirePerm(manifest, "connections:read");
        const all = await listAllConnections();
        return all.find((c) => c.id === connId) ?? null;
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
        refuseTeamWrite(connId, "updated");
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
        refuseTeamWrite(connId, "deleted");
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
            identity_id: item.identity_id,
            jump_hosts: item.jump_hosts,
          });
          results.push(conn as PluginConnection);
        }
        await useConnectionStore.getState().loadConnections();
        return results;
      },
      subscribe(cb) {
        requirePerm(manifest, "connections:read");
        return useConnectionStore.subscribe((s) => {
          const merged = new Map<string, PluginConnection>();
          for (const c of s.connections) merged.set(c.id, c as PluginConnection);
          for (const c of teamConnectionList()) merged.set(c.id, { ...(c as PluginConnection), team: true });
          cb([...merged.values()]);
        });
      },
    },

    vaults: {
      list() {
        requireGated("vaults:read");
        return vaultsApi.list();
      },
      create(name) {
        requireGated("vaults:write");
        return vaultsApi.create(name);
      },
      rename(vaultId, name) {
        requireGated("vaults:write");
        vaultsApi.rename(vaultId, name);
      },
      async delete(vaultId, opts) {
        requireGated("vaults:write");
        await vaultsApi.delete(vaultId, opts);
      },
    },

    folders: {
      list(kind) {
        requireGated("folders:read");
        return foldersApi.list(kind);
      },
      async create(input) {
        requireGated("folders:write");
        return foldersApi.create(input);
      },
      async rename(folderId, name) {
        requireGated("folders:write");
        await foldersApi.rename(folderId, name);
      },
      async delete(folderId, opts) {
        requireGated("folders:write");
        await foldersApi.delete(folderId, opts);
      },
    },

    // The gate is handed to the verb rather than run before it: the permissions
    // can only be read off hydrated stores — on a fresh app every id resolves to
    // nothing and a correctly scoped plugin would be refused — and hydration
    // includes a team-vault sync, so gating out here meant doing all of it twice.
    objects: {
      move: (input) => objectsApi.move(input, requireEachGated),
      copy: (input) => objectsApi.copy(input, requireEachGated),
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
        // Keybinding only: a disable clears those but leaves store contributions.
        if (command.keybinding && whileActive("omni.register keybinding")) {
          formattedKeybinding = registerKeybinding(id, command.id, command.keybinding, () => {
            void command.execute();
          });
        }
        store().registerOmniCommand({ ...command, keybinding: formattedKeybinding ?? command.keybinding });
        trackContribution(id, command.id);
        return () => {
          store().unregisterOmniCommand(command.id);
          _pluginKeybindings.delete(command.id);
        };
      },
      unregister(cmdId) {
        requirePerm(manifest, "omni-commands");
        if (!ownsContribution(id, cmdId)) {
          console.warn(`[plugin-runtime] "${id}" tried to unregister command "${cmdId}", which it did not register — ignoring`);
          return;
        }
        store().unregisterOmniCommand(cmdId);
        _pluginKeybindings.delete(cmdId);
      },
    },

    ui: {
      registerSettingsPage(page) {
        requirePerm(manifest, "settings-page");
        // Ensure page ID is prefixed with plugin ID so unregisterAll and store filters work correctly
        const prefixed = { ...page, id: page.id.startsWith(`${id}:`) ? page.id : `${id}:${page.id}` };
        store().registerSettingsPage(prefixed);
        trackContribution(id, prefixed.id);
        return () => store().unregisterSettingsPage(prefixed.id);
      },
      registerRightPanelSection(section) {
        requirePerm(manifest, "right-panel");
        const prefixed = { ...section, id: section.id.startsWith(`${id}:`) ? section.id : `${id}:${section.id}` };
        store().registerRightPanelSection(prefixed);
        trackContribution(id, prefixed.id);
        return () => store().unregisterRightPanelSection(prefixed.id);
      },
      registerGlobalPanel(panel) {
        requirePerm(manifest, "global-panel");
        const prefixed = { ...panel, id: panel.id.startsWith(`${id}:`) ? panel.id : `${id}:${panel.id}` };
        store().registerGlobalPanel(prefixed);
        trackContribution(id, prefixed.id);

        const ui = () => useUIStore.getState();

        const handle = (() => {
          store().unregisterGlobalPanel(prefixed.id);
          releaseDockedWidth(prefixed.id);
        }) as GlobalPanelHandle;

        return Object.assign(handle, {
          id: prefixed.id,
          open: () => { if (whileActive("ui.globalPanel.open")) ui().setGlobalPanelOpen(prefixed.id, true); },
          close: () => { if (whileActive("ui.globalPanel.close")) ui().setGlobalPanelOpen(prefixed.id, false); },
          toggle: () => { if (whileActive("ui.globalPanel.toggle")) ui().toggleGlobalPanel(prefixed.id); },
          isOpen: () => Boolean(ui().globalPanelOpen[prefixed.id]),
          setDockedWidth: (width: number) => {
            if (!whileActive("ui.globalPanel.setDockedWidth")) return;
            _dockedPanelWidths.set(prefixed.id, { pluginId: id, width });
            ui().setDockedPanelWidth(width);
          },
        });
      },
      registerMobileScreen(screen) {
        requirePerm(manifest, "right-panel");
        const prefixed = { ...screen, id: screen.id.startsWith(`${id}:`) ? screen.id : `${id}:${screen.id}` };
        store().registerMobileScreen(prefixed);
        trackContribution(id, prefixed.id);
        return () => store().unregisterMobileScreen(prefixed.id);
      },
      pushMobileScreen(entry) {
        requirePerm(manifest, "ui");
        useMobileNavStore.getState().push(toMobileNavScreen(entry));
      },
      focusMobileTerminal() {
        requirePerm(manifest, "ui");
        useMobileNavStore.getState().setTab("terminal");
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
        // Scoped to this plugin's own contributions: the store maps are one global
        // namespace, so without this a zero-permission plugin could remove another
        // plugin's UI by guessing an id. No permission check beyond that — an id can
        // only be in the ledger because a permitted register verb put it there.
        if (!ownsContribution(id, itemId)) {
          console.warn(`[plugin-runtime] "${id}" tried to unregister "${itemId}", which it did not register — ignoring`);
          return;
        }
        const s = store();
        s.unregisterOmniCommand(itemId);
        s.unregisterSettingsPage(itemId);
        s.unregisterRightPanelSection(itemId);
        s.unregisterGlobalPanel(itemId);
        s.unregisterMobileScreen(itemId);
      },
      setActiveNav(id) {
        requirePerm(manifest, "ui");
        useUIStore.getState().setActiveNav(id as NavItem);
      },
      publishState(key, value) {
        requirePerm(manifest, "ui");
        if (!whileActive("ui.publishState")) return;
        usePluginStateStore.getState().publish(id, key, value);
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

    audit: {
      record(connectionId, action, metadata, localMetadata) {
        requirePerm(manifest, "audit");
        if (!PLUGIN_AUDIT_ACTIONS.includes(action)) {
          throw new Error(`Plugin "${id}" used an unsupported audit action "${action}"`);
        }
        if (!whileActive("audit.record")) return;

        const conn = connectionId ? findConnection(connectionId) : undefined;
        const context = conn ? auditContextForVaultId(conn.vault_id) : { kind: "local" as const, vaultId: "personal" };
        const targetName = conn
          ? conn.name?.trim() || `${conn.username}@${conn.host}:${conn.port}`
          : (connectionId ?? "local");

        reportPluginAuditEvent(context, action, {
          target_type: "plugin",
          target_id: connectionId ?? "local",
          target_name: targetName,
          // Stamped last so a plugin cannot claim to be another one.
          metadata: { ...metadata, plugin_id: id },
          localMetadata,
        });
      },
      async query(filters) {
        requireGated("audit:read");
        if (!whileActive("audit.query")) return { logs: [], total: 0 };
        // "personal" is the local sink's vault key for every non-team row:
        // auditContextForVaultId returns { kind: "local", vaultId: "personal" }
        // when there is no team vault, and that is the key reportLocalClientEvent
        // writes under.
        const { logs, total } = await fetchLocalAuditLogs("personal", {
          actions: filters.actions,
          from: filters.from,
          to: filters.to,
          page: Math.max(1, filters.page ?? 1),
          per_page: Math.min(100, Math.max(1, filters.perPage ?? 50)),
        });
        return { logs: logs.map(toPluginAuditRow), total };
      },
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
      async stream(url, init) {
        requirePerm(manifest, "http");
        return sseFetch(url, init);
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
        if (!whileActive("notifications.toast")) return;
        const { severity = "info", duration = 2500, action } = opts;
        const pluginName = manifest.name.slice(0, 20);
        useNotificationStore.getState().addToast({
          pluginId: id, pluginName, type: "toast",
          message, severity, duration, action,
        });
      },

      progress(title, opts = {}) {
        requirePerm(manifest, "notifications");
        if (!whileActive("notifications.progress")) {
          return { update() {}, finish() {}, error() {}, cancel() {} };
        }
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
        if (!whileActive("notifications.banner")) {
          return { dismiss() {}, update() {} };
        }
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
          localShell: s.localShell,
        }));
      },
      getActive() {
        requirePerm(manifest, "sessions:read");
        const { sessions, activeSessionId } = useSessionStore.getState();
        if (!activeSessionId) return null;
        const s = sessions.find((x) => x.id === activeSessionId);
        if (!s) return null;
        return {
          id: s.id,
          connectionId: s.connectionId,
          connectionName: s.connectionName,
          status: s.status,
          type: s.type,
          localShell: s.localShell,
        };
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
        requireGated("terminal:write");
        const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (!session) throw new Error(`Session "${sessionId}" not found`);
        // Three transports, mirroring onOutput above and sendSessionInput in
        // useTerminal.ts. Serial used to fall through to the SSH branch, which
        // writes to a channel a serial session does not have — so every write to
        // a serial device was silently dropped.
        const encoded = new TextEncoder().encode(cmd + "\n");
        if (session.type === "local") {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("local_send_input", { sessionId, data: Array.from(encoded) });
        } else if (session.type === "serial") {
          await serialWrite(sessionId, encoded);
        } else {
          await sshSendInput(sessionId, encoded);
        }
      },
      async open(connectionId) {
        requirePerm(manifest, "sessions:write");
        return useSessionStore.getState().connect(connectionId);
      },
      async close(sessionId) {
        requirePerm(manifest, "sessions:write");
        await useSessionStore.getState().disconnect(sessionId);
      },
    },

    terminal: {
      readSnapshot(sessionId, maxLines = 200) {
        requireGated("terminal:read");
        return readTerminalSnapshot(sessionId, maxLines);
      },
      readSelection(sessionId) {
        requireGated("terminal:read");
        return readTerminalSelection(sessionId);
      },
      async onOutput(sessionId, cb) {
        requireGated("terminal:stream");
        const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (!session) throw new Error(`Session "${sessionId}" not found`);
        const decoder = new TextDecoder();
        const handler = (data: Uint8Array) => cb(decoder.decode(data, { stream: true }));
        if (session.type === "local") return onLocalOutput(sessionId, handler);
        if (session.type === "serial") return onSerialOutput(sessionId, handler);
        return onSshOutput(sessionId, handler);
      },
    },

    // Keychain — GATED. OS-local, unsynced. Keys are namespaced per plugin
    // (prefix "plugin:<id>:") so keychain:read cannot reach another plugin's secrets.
    keychain: {
      async get(key) {
        requireGated("keychain:read");
        return invoke<string | null>("keychain_get", { key: kcKey(key) });
      },
      async set(key, value) {
        requireGated("keychain:write");
        await invoke("keychain_set", { key: kcKey(key), value });
      },
      async delete(key) {
        requireGated("keychain:write");
        await invoke("keychain_delete", { key: kcKey(key) });
      },
    },

    streams: {
      start: (kind, opts) => {
        requireGated(STREAM_PERM[kind]);
        return streamsApi.start(kind, opts);
      },
      stop: (streamId) => streamsApi.stop(streamId),
      on: (streamId, cb) => streamsApi.on(streamId, cb),
    },

    metrics: {
      start: (sessionId, isRemote) => {
        requireGated("metrics:read");
        return metricsApi.start(sessionId, isRemote);
      },
      stop: (streamId) => metricsApi.stop(streamId),
      onSnapshot: (streamId, cb) => {
        requireGated("metrics:read");
        return metricsApi.onSnapshot(streamId, cb);
      },
      getSystemInfo: (sessionId, sessionType, sessionName) => {
        requireGated("metrics:read");
        return metricsApi.getSystemInfo(sessionId, sessionType, sessionName);
      },
    },

    processes: {
      start: (sessionId, isRemote) => {
        requireGated("processes:read");
        return processesApi.start(sessionId, isRemote);
      },
      stop: (streamId) => {
        requireGated("processes:read");
        return processesApi.stop(streamId);
      },
      onSnapshot: (streamId, cb) => {
        requireGated("processes:read");
        return processesApi.onSnapshot(streamId, cb);
      },
      kill: (sessionId, pid, isRemote, force) => {
        requireGated("processes:manage");
        return processesApi.kill(sessionId, pid, isRemote, force);
      },
    },

    crypto: {
      deriveKey: (passphrase, saltHex) => {
        requirePerm(manifest, "crypto:derive");
        return cryptoApi.deriveKey(passphrase, saltHex);
      },
    },

    i18n: {
      register(catalog) {
        requirePerm(manifest, "ui");
        i18nApi.register(catalog);
      },
      t(key, vars) {
        requirePerm(manifest, "ui");
        return i18nApi.t(key, vars);
      },
      getLocale() {
        requirePerm(manifest, "ui");
        return i18nApi.getLocale();
      },
      onLocaleChange(cb) {
        requirePerm(manifest, "ui");
        return i18nApi.onLocaleChange(cb);
      },
    },

    // Every verb is wrapped individually rather than handing the domain over
    // wholesale: without a per-verb requireGated the read tier would grant the
    // write tier too, which is exactly the hole the metrics domain shipped with.
    sftp: {
      list: (target, path) => { requireGated("sftp:read"); return sftpApi.list(target, path); },
      stat: (target, path) => { requireGated("sftp:read"); return sftpApi.stat(target, path); },
      readText: (target, path, maxBytes) => {
        requireGated("sftp:read");
        return sftpApi.readText(target, path, maxBytes);
      },
      writeText: (target, path, content) => {
        requireGated("sftp:write");
        return sftpApi.writeText(target, path, content);
      },
      mkdir: (target, path) => { requireGated("sftp:write"); return sftpApi.mkdir(target, path); },
      rename: (target, from, to) => { requireGated("sftp:write"); return sftpApi.rename(target, from, to); },
      delete: (target, path) => { requireGated("sftp:write"); return sftpApi.delete(target, path); },
      transfer: (src, dst) => { requireGated("sftp:write"); return sftpApi.transfer(src, dst); },
      // Ungated: releasing a handle this plugin opened cannot expose or change
      // anything, and a plugin must always be able to let go of its own resources.
      disconnect: (target) => sftpApi.disconnect(target),
    },

    proxmox: {
      lxc: {
        list: (sessionId) => {
          requireGated("proxmox:read");
          return proxmoxApi.lxc.list(sessionId);
        },
        action: (sessionId, vmid, action) => {
          requireGated("proxmox:manage");
          return proxmoxApi.lxc.action(sessionId, vmid, action);
        },
        // Beyond the invoke, this registers the new exec session in the session
        // store and marks it connected — the same bookkeeping useSessionStore.connect
        // does for a normal SSH connect. A plugin has no store access of its own
        // (sessions:write only covers connecting *saved connections*), so this lives
        // here rather than in the pure domains/proxmox.ts invoke wrapper. The mobile
        // Proxmox screen calls this same api.proxmox.lxc.openShell — see
        // @/services/proxmox.ts's registerLxcExecSession for the shared bookkeeping.
        openShell: async (sessionId, vmid, vmName) => {
          requireGated("proxmox:manage");
          const execSessionId = await proxmoxApi.lxc.openShell(sessionId, vmid);
          const parent = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
          await registerLxcExecSession({
            execSessionId,
            parentSessionId: sessionId,
            connectionId: parent?.connectionId ?? "",
            vmid,
            vmName,
          });
          return execSessionId;
        },
        snapshots: {
          list: (sessionId, vmid) => {
            requireGated("proxmox:read");
            return proxmoxApi.lxc.snapshots.list(sessionId, vmid);
          },
          create: (sessionId, vmid, name, description) => {
            requireGated("proxmox:manage");
            return proxmoxApi.lxc.snapshots.create(sessionId, vmid, name, description);
          },
          rollback: (sessionId, vmid, name) => {
            requireGated("proxmox:manage");
            return proxmoxApi.lxc.snapshots.rollback(sessionId, vmid, name);
          },
          remove: (sessionId, vmid, name) => {
            requireGated("proxmox:manage");
            return proxmoxApi.lxc.snapshots.remove(sessionId, vmid, name);
          },
        },
      },
    },

    docker: {
      containers: {
        list: (target) => { requireGated("docker:read"); return dockerApi.containers.list(target); },
        action: (target, containerId, action) => {
          requireGated("docker:manage");
          return dockerApi.containers.action(target, containerId, action);
        },
        runCommand: (target, containerId, command) => {
          requireGated("docker:manage");
          return dockerApi.containers.runCommand(target, containerId, command);
        },
      },
      images: {
        list: (target) => { requireGated("docker:read"); return dockerApi.images.list(target); },
        remove: (target, imageId) => { requireGated("docker:manage"); return dockerApi.images.remove(target, imageId); },
        pull: (target, image) => { requireGated("docker:manage"); return dockerApi.images.pull(target, image); },
        checkUpdate: (target, imageId) => {
          requireGated("docker:read");
          return dockerApi.images.checkUpdate(target, imageId);
        },
        update: (target, imageId, recreate) => {
          requireGated("docker:manage");
          return dockerApi.images.update(target, imageId, recreate);
        },
        recreateContainers: (target, imageId) => {
          requireGated("docker:manage");
          return dockerApi.images.recreateContainers(target, imageId);
        },
        prune: (target) => { requireGated("docker:manage"); return dockerApi.images.prune(target); },
      },
      volumes: {
        list: (target) => { requireGated("docker:read"); return dockerApi.volumes.list(target); },
        remove: (target, name) => { requireGated("docker:manage"); return dockerApi.volumes.remove(target, name); },
        prune: (target) => { requireGated("docker:manage"); return dockerApi.volumes.prune(target); },
      },
      networks: {
        list: (target) => { requireGated("docker:read"); return dockerApi.networks.list(target); },
        remove: (target, id) => { requireGated("docker:manage"); return dockerApi.networks.remove(target, id); },
        prune: (target) => { requireGated("docker:manage"); return dockerApi.networks.prune(target); },
      },
      stacks: {
        list: (target) => { requireGated("docker:read"); return dockerApi.stacks.list(target); },
        services: (target, stack) => { requireGated("docker:read"); return dockerApi.stacks.services(target, stack); },
        action: (target, stack, action) => {
          requireGated("docker:manage");
          return dockerApi.stacks.action(target, stack, action);
        },
        update: (target, stack) => { requireGated("docker:manage"); return dockerApi.stacks.update(target, stack); },
      },
      logs: {
        start: (target, containerId, tail) => {
          requireGated("docker:read");
          return dockerApi.logs.start(target, containerId, tail);
        },
        startStack: (target, stack, tail) => {
          requireGated("docker:read");
          return dockerApi.logs.startStack(target, stack, tail);
        },
        stop: (streamId) => { requireGated("docker:read"); return dockerApi.logs.stop(streamId); },
        on: (streamId, cb) => { requireGated("docker:read"); return dockerApi.logs.on(streamId, cb); },
      },
      system: {
        prune: (target) => { requireGated("docker:manage"); return dockerApi.system.prune(target); },
      },
      // Beyond the invoke (remote) / local PTY spawn (local), this registers the
      // new exec session in the session store — the same bookkeeping
      // useSessionStore.connect does for a normal connect. A plugin has no store
      // access of its own, so this lives here rather than in the pure
      // domains/docker.ts wrapper. Mirrors proxmox's openShell wiring above; like
      // openShell, nav-switching is the caller's job, not this primitive's.
      exec: {
        open: async (target, containerId, containerName) => {
          requireGated("docker:manage");
          const label = containerName ? `exec: ${containerName}` : `exec: ${containerId.slice(0, 12)}`;

          if (target.isRemote) {
            const execSessionId = await dockerApi.exec.open(target, containerId);
            const parent = useSessionStore.getState().sessions.find((s) => s.id === target.sessionId);
            useSessionStore.setState((s) => ({
              sessions: [
                ...s.sessions,
                {
                  id: execSessionId,
                  connectionId: parent?.connectionId ?? "",
                  connectionName: label,
                  status: "connecting" as const,
                  type: "ssh" as const,
                  containerExec: { kind: "docker" as const, containerId, parentSessionId: target.sessionId },
                },
              ],
              activeSessionId: execSessionId,
            }));
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            useSessionStore.setState((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === execSessionId ? { ...sess, status: "connected" as const } : sess,
              ),
            }));
            return execSessionId;
          }

          const newSessionId = crypto.randomUUID();
          useSessionStore.setState((s) => ({
            sessions: [
              ...s.sessions,
              {
                id: newSessionId,
                connectionId: "local",
                connectionName: label,
                status: "connecting" as const,
                type: "local" as const,
                localShell: target.localShell ?? undefined,
              },
            ],
            activeSessionId: newSessionId,
          }));
          try {
            await localConnect(newSessionId, 80, 24, target.localShell ?? undefined);
            await localSendInput(newSessionId, new TextEncoder().encode(`docker exec -it ${containerId} sh\r`));
            useSessionStore.setState((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === newSessionId ? { ...sess, status: "connected" as const } : sess,
              ),
            }));
          } catch (e) {
            useSessionStore.setState((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === newSessionId ? { ...sess, status: "error" as const } : sess,
              ),
            }));
            throw e;
          }
          return newSessionId;
        },
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
        if (!whileActive("plugins.expose")) return;
        _exposedApis.set(id, publicApi);
      },
      getApi(pluginId) {
        return _exposedApis.get(pluginId) ?? null;
      },
    },

    mcp: {
      registerTools(tools) {
        requireGated("mcp:contribute");
        // An async continuation in a disabled plugin would otherwise re-register
        // tools that setPluginActive(false) already cleared, with nothing left
        // to clear them again.
        if (!whileActive("mcp.registerTools")) return () => {};
        return registerContributions(id, tools);
      },
    },
  };

  return api;
}

/** Host-internal consumers (the MCP server) need a PluginAPI without being
 *  plugins. Kept as a named export rather than letting a caller synthesize a
 *  manifest, so every non-plugin consumer is greppable. */
export function createHostPluginAPI(id: string, permissions: string[]): PluginAPI {
  if (isValidPluginId(id)) {
    throw new Error(`createHostPluginAPI id ${JSON.stringify(id)} is a legal plugin id; a real plugin could claim it and inherit the host's whileActive bypass`);
  }
  _hostApiIds.add(id);
  return createPluginAPI({ id, name: id, version: "0.0.0", permissions });
}

// ─── Registry ─────────────────────────────────────────────────────────────

interface PluginEntry {
  manifest: PluginManifest;
  register: PluginRegisterFn;
  cleanup: (() => void) | void;
  active: boolean;
  /** Load provenance, NOT an authorization input — permissions gate on the manifest
   *  plus install-time consent. See requireGated for where a wall would go. */
  trusted: boolean;
  api: ReturnType<typeof createPluginAPI>;
  css?: string;
}

const _registry = new Map<string, PluginEntry>();

/** Ids whose register() is currently running — present in _registry but not yet
 *  loaded. See loadPlugin for why the entry has to exist that early. */
const _loading = new Set<string>();

/**
 * @param css The plugin's stylesheet, if any. The caller (seeded/marketplace loader)
 * already injected it via `importPluginModule`/`injectPluginStyle` before calling this —
 * passing it here only lets the registry re-inject on reactivation and remove it on
 * every teardown path, so a disabled or unloaded plugin's CSS doesn't outlive it.
 */
export function loadPlugin(
  manifest: PluginManifest,
  register: PluginRegisterFn,
  active = true,
  trusted = false,
  css?: string,
): void {
  // Before anything is keyed by this id — registry entry, storage namespace,
  // keychain prefix, contributed-id prefixes. Every loader wraps this in a
  // try/catch that warns and skips, so a malformed id costs that one plugin.
  assertValidPluginId(manifest.id);
  if (_registry.has(manifest.id)) {
    console.warn(`[plugin-runtime] Plugin "${manifest.id}" already loaded — skipping`);
    return;
  }
  const api = createPluginAPI(manifest);
  if (manifest.contributes?.configuration) {
    void populateDefaults(manifest.id, manifest.contributes.configuration);
  }
  const entry: PluginEntry = { manifest, register, cleanup: undefined, active, trusted, api, css };
  // The entry has to exist before register() runs — re-entrant API calls resolve
  // through it (api.plugins.isActive() is _registry.get(id).active). But "has an
  // entry" is not "is loaded": until register() returns, the plugin has no cleanup
  // and may still throw and be rolled back. _loading keeps it out of introspection
  // for exactly that window, so nothing can observe it as a loaded plugin.
  _registry.set(manifest.id, entry);
  _loading.add(manifest.id);
  try {
    entry.cleanup = register(api);
  } catch (e) {
    // register() may have registered several contributions before throwing. Roll
    // every one of them back — same teardown as unloadPlugin — so a plugin that
    // fails partway through never ends up half-loaded: live contributions with no
    // registry entry, or a registry entry reported as loaded with cleanup: undefined.
    entry.cleanup?.();
    usePluginStore.getState().unregisterAll(manifest.id);
    useUIContributionStore.getState().unregisterPlugin(manifest.id);
    useNotificationStore.getState().dismissAllForPlugin(manifest.id);
    usePluginStateStore.getState().clearPlugin(manifest.id);
    clearPluginKeybindings(manifest.id);
    clearPluginDockedWidths(manifest.id);
    clearContributions(manifest.id);
    removePluginStyle(manifest.id);
    _exposedApis.delete(manifest.id);
    _contributedIds.delete(manifest.id);
    _settingsListeners.delete(manifest.id);
    _registry.delete(manifest.id);
    throw e;
  } finally {
    _loading.delete(manifest.id);
  }
  console.info(`[plugin-runtime] Loaded plugin "${manifest.id}" v${manifest.version} (active=${active}, trusted=${trusted})`);
  // register() has to run even when the plugin is disabled — that is how imperative
  // contributions meant to outlive a disable (e.g. a settings page) get registered.
  // Everything else it published is exactly what a disable toggle tears down, so
  // apply that same teardown here: without it a disabled plugin re-leaks its exposed
  // API, stylesheet, right-panel section, published state and keybindings on every
  // boot, since all loaders pass the user's override straight through as `active`.
  if (!active) setPluginActive(manifest.id, false);
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
  clearPluginKeybindings(pluginId);
  entry.active = active;
  if (active) {
    if (entry.css) injectPluginStyle(pluginId, entry.css);
    entry.cleanup = entry.register(entry.api);
  } else {
    useNotificationStore.getState().dismissAllForPlugin(pluginId);
    usePluginStateStore.getState().clearPlugin(pluginId);
    removePluginStyle(pluginId);
    // A disabled plugin's exposed API is a live, side-effecting callable
    // (unlike e.g. a settings page registration) — it must not stay reachable
    // while disabled. register() re-populates it via api.plugins.expose() on
    // reactivation, same as it re-registers other imperative contributions.
    _exposedApis.delete(pluginId);
    // The contribution ledger deliberately survives a disable: contributions meant
    // to outlive it (a settings page registered imperatively and left out of
    // cleanup) are still live, and the plugin must stay able to unregister them.
    // Separate registry from the ledger above: MCP tool contributions do NOT survive a disable.
    clearContributions(pluginId);
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
  usePluginStateStore.getState().clearPlugin(pluginId);
  clearPluginKeybindings(pluginId);
  clearPluginDockedWidths(pluginId);
  clearContributions(pluginId);
  removePluginStyle(pluginId);
  _exposedApis.delete(pluginId);
  _sftpDisposers.get(pluginId)?.();
  _sftpDisposers.delete(pluginId);
  _contributedIds.delete(pluginId);
  _settingsListeners.delete(pluginId);
  _registry.delete(pluginId);
  console.info(`[plugin-runtime] Unloaded plugin "${pluginId}"`);
}

export function unloadAll(): void {
  for (const id of _registry.keys()) unloadPlugin(id);
}

export function getLoadedPlugins(): PluginManifest[] {
  return [..._registry.values()]
    .filter((e) => !_loading.has(e.manifest.id))
    .map((e) => e.manifest);
}

/** Read a plugin's storage value — for use by trusted UI code (e.g. auto-generated settings). */
export function pluginStorageGet<T>(pluginId: string, key: string): Promise<T | null> {
  return storageGet<T>(pluginId, key);
}

/** Write a plugin's storage value — for use by trusted UI code (e.g. auto-generated settings). */
export function pluginStorageSet<T>(pluginId: string, key: string, value: T): Promise<void> {
  return storageSet<T>(pluginId, key, value);
}

/** Read a plugin's exposed public API (via `api.plugins.expose`) — for use by
 *  trusted host UI that needs to call into a built-in plugin without importing
 *  its module. Returns null if the plugin hasn't exposed anything. */
export function getExposedApi(pluginId: string): unknown | null {
  return _exposedApis.get(pluginId) ?? null;
}
