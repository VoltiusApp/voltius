import type { ReactNode } from "react";
import type { SerialConnectParams } from "@/types";
import type { AppTheme } from "@/themes/types";

// ─── Types exposés aux plugins ─────────────────────────────────────────────

export interface PluginConnection {
  id: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  tags: string[];
  identity_id?: string;
  jump_hosts?: import("@/types").JumpHost[];
}

export interface PluginConnectionInput {
  name?: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  tags?: string[];
  identity_id?: string;
  jump_hosts?: import("@/types").JumpHost[];
}

export interface PluginKey {
  id: string;
  name?: string;
  key_type?: string;
}

export interface PluginIdentity {
  id: string;
  name?: string;
  username: string;
  key_id?: string;
}

export interface OmniCommand {
  id: string;
  label: string;
  icon: string;
  keywords?: string[];
  section?: string;
  /** Optional keyboard shortcut. Format: "ctrl+k", "meta+shift+p". First-registered wins on conflict. */
  keybinding?: string;
  /** ID of a core shortcut to resolve as the hint (reactive, updates when user rebinds). */
  shortcutId?: string;
  execute: () => void | Promise<void>;
}

export interface SettingsPage {
  id: string;
  label: string;
  icon: string;
  component: React.FC;
}

export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  component: React.FC;
  position?: "top" | "bottom";
}

export interface RightPanelSection {
  id: string;
  label: string;
  icon: string;
  component: React.FC;
}

export interface PluginSession {
  id: string;
  connectionId: string;
  connectionName: string;
  status: string;
  type: string;
}

export type ContextMenuTarget = "connection" | "session" | "tab";

export interface ContextMenuContext {
  connection?: PluginConnection;
  sessionId?: string;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  target: ContextMenuTarget | ContextMenuTarget[];
  action: (ctx: ContextMenuContext) => void | Promise<void>;
}

export type PluginTheme = AppTheme;

// ─── Notification types ────────────────────────────────────────────────────

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  severity?: ToastSeverity;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface ProgressOptions {
  indeterminate?: boolean;
  cancellable?: boolean;
}

export interface ProgressHandle {
  update(value: number, message?: string): void;
  finish(message?: string): void;
  error(message: string): void;
  cancel(): void;
}

export interface BannerOptions {
  severity?: ToastSeverity;
  actions?: Array<{ label: string; onClick: () => void }>;
  dismissable?: boolean;
  flashToast?: boolean;
}

export interface BannerHandle {
  dismiss(): void;
  update(message: string): void;
}

// ─── UI Contribution types ─────────────────────────────────────────────────

/** A single action item contributed by a plugin to a UI slot. */
export interface ContributedAction {
  label: string;
  icon?: string;
  onClick: () => void;
  divider?: boolean;
  danger?: boolean;
  /** Keyboard shortcut hint displayed on the right in context menus */
  shortcut?: string;
  /** If provided, item is only shown when this returns true. Errors are treated as false. */
  when?: (context: unknown) => boolean;
}

/** Named UI slots where plugins can inject actions. */
export type UISlot =
  | "connection.contextMenu"
  | "connection.panelActions"
  | "key.contextMenu"
  | "key.panelActions"
  | "identity.contextMenu"
  | "identity.panelActions"
  | "home.bgContextMenu"
  | "keychain.bgContextMenu"
  | "home.toolbar.hostMenu"
  | "settings.vaults";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UIContributionFactory = (ctx: any) => ContributedAction[];

export type UIStatusBarSlot = "terminal.statusBar.right";

export interface TerminalStatusBarContributionContext {
  sessionId: string;
  sessionType: "ssh" | "serial";
  connectionId: string;
  sessionStatus: "connecting" | "connected" | "disconnected" | "error";
  connection?: PluginConnection;
  serialConfig?: SerialConnectParams;
  dimensions?: { cols: number; rows: number };
}

export type UIStatusBarContributionFactory = (ctx: TerminalStatusBarContributionContext) => ReactNode;

// ─── API principale ────────────────────────────────────────────────────────

export interface PluginAPI {
  pluginId: string;
  /** Returns true if this plugin is currently enabled in the registry. */
  isActive(): boolean;

  // Clés SSH (requiert keys:*)
  keys: {
    list(): Promise<PluginKey[]>;
    /** Creates a key entry and stores private/public content in the vault. */
    create(data: { name?: string; key_type?: string }, privateKey: string, publicKey?: string): Promise<PluginKey>;
    delete(id: string): Promise<void>;
  };

  // Identités (requiert identities:*)
  identities: {
    list(): Promise<PluginIdentity[]>;
    create(data: { name?: string; username: string; key_id?: string }): Promise<PluginIdentity>;
    delete(id: string): Promise<void>;
  };

  // Connexions (requiert connections:*)
  connections: {
    list(): Promise<PluginConnection[]>;
    get(id: string): Promise<PluginConnection | null>;
    create(data: PluginConnectionInput): Promise<PluginConnection>;
    update(id: string, data: Partial<PluginConnectionInput>): Promise<void>;
    delete(id: string): Promise<void>;
    bulkImport(items: PluginConnectionInput[]): Promise<PluginConnection[]>;
    subscribe(cb: (connections: PluginConnection[]) => void): () => void;
  };

  // Vault — secrets scopés au plugin (requiert vault:*)
  vault: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Thèmes (requiert "themes")
  themes: {
    register(theme: PluginTheme): void;
    unregister(id: string): void;
  };

  // OmniSearch (requiert "omni-commands")
  omni: {
    register(command: OmniCommand): () => void;
    unregister(id: string): void;
  };

  // UI — points d'extension
  ui: {
    registerSettingsPage(page: SettingsPage): () => void;
    registerSidebarItem(item: SidebarItem): () => void;
    registerRightPanelSection(section: RightPanelSection): () => void;
    registerContextMenuItem(item: ContextMenuItem): () => void;
    /** Inject action items into a named UI slot. Returns a cleanup function. */
    registerContribution<C = unknown>(slot: UISlot, fn: (ctx: C) => ContributedAction[]): () => void;
    /** Render a React widget in the terminal status bar's right-side slot. Returns a cleanup function. */
    registerStatusBarItem(slot: UIStatusBarSlot, fn: UIStatusBarContributionFactory): () => void;
    unregister(id: string): void;
  };

  // Stockage clé-valeur propre au plugin
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // HTTP (requiert "http")
  http: {
    get<T>(url: string, opts?: RequestInit): Promise<T>;
    post<T>(url: string, body: unknown, opts?: RequestInit): Promise<T>;
  };

  // Système de fichiers restreint au home (requiert "fs")
  fs: {
    readText(path: string): Promise<string>;
    writeText(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    /** Polling-based file watch. Calls cb when content changes. Returns cleanup fn. */
    watch(path: string, cb: () => void, opts?: { intervalMs?: number }): () => void;
  };

  // Bus d'événements (toujours disponible)
  events: {
    on(event: string, handler: (data: unknown) => void): () => void;
    emit(event: string, data?: unknown): void;
  };

  // Notifications (requiert "notifications")
  notifications: {
    toast(message: string, opts?: ToastOptions): void;
    progress(title: string, opts?: ProgressOptions): ProgressHandle;
    banner(message: string, opts?: BannerOptions): BannerHandle;
  };

  // Logger scopé au plugin
  log: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };

  // Sessions (requiert sessions:read / sessions:write)
  sessions: {
    /** Returns current sessions snapshot. */
    list(): PluginSession[];
    /** Fires when a session becomes connected. */
    onConnected(cb: (session: PluginSession) => void): () => void;
    /** Fires when a connected session is removed or disconnected. */
    onDisconnected(cb: (session: PluginSession) => void): () => void;
    /** Fires when the user switches to a different terminal tab. */
    onActivated(cb: (session: PluginSession) => void): () => void;
    /** Send a command to a session. Runtime appends \n. Requires sessions:write. */
    sendCommand(sessionId: string, cmd: string): Promise<void>;
  };

  // Lifecycle hooks (toujours disponible)
  lifecycle: {
    /** Fires when an SSH/local session transitions to "connected". */
    onConnectionEstablished(cb: (conn: PluginConnection) => void): () => void;
    /** Fires when a connected session is removed or becomes disconnected. */
    onConnectionClosed(cb: (conn: PluginConnection) => void): () => void;
    /** Fires when the user switches to a different terminal tab. */
    onSessionActivated(cb: (session: PluginSession) => void): () => void;
    /** Fires when this plugin's own storage.set() is called. */
    onSettingsChanged(cb: (key: string, value: unknown) => void): () => void;
    /** Fires before the app closes. Must resolve within 5 seconds. */
    onBeforeQuit(cb: () => void | Promise<void>): () => void;
    /** Resolves once the login-time server sync has completed (or immediately for local/offline users). */
    waitForLoginSync(): Promise<void>;
  };

  // Sync / blob storage (requiert sync:read / sync:write)
  sync: {
    /** Read a plugin-scoped blob from local storage. Returns null if not set. */
    getBlob(key: string): Promise<Uint8Array | null>;
    /** Write a plugin-scoped blob to local storage. Max 1 MB. */
    setBlob(key: string, data: Uint8Array): Promise<void>;
    /**
     * Register a callback that fires after a sync completes and the stored
     * blob for `key` has changed. Note: cross-device sync of plugin blobs
     * requires future Tauri backend support — currently fires on local changes only.
     */
    onRemoteChange(key: string, cb: (data: Uint8Array) => void): () => void;
    /** Reload a named in-app store (e.g. "connections", "identities", "keys"). */
    triggerReload(storeKey: string): Promise<void>;
    /**
     * Export the full app state (connections, keys, identities, secrets) as a
     * base64-encoded AES-256-GCM encrypted blob — same format as cloud sync.
     * encKey: 64-char hex string (32 bytes). Requires sync:write.
     */
    exportState(encKey: string, deviceId: string): Promise<string>;
    /**
     * CRDT-merge one or more remote encrypted blobs into local state, then
     * reload all entity stores. blobs: base64-encoded (same format as exportState).
     * Requires sync:write.
     */
    importStates(encKey: string, blobs: string[]): Promise<void>;
  };

  // Inter-plugin communication (toujours disponible)
  plugins: {
    /** Publish this plugin's public API surface so other plugins can consume it. */
    expose(publicApi: unknown): void;
    /** Get another plugin's exposed API. Returns null if not loaded or not exposed. */
    getApi(pluginId: string): unknown | null;
  };
}

export type PluginRegisterFn = (api: PluginAPI) => (() => void) | void;

// ─── Settings schema ───────────────────────────────────────────────────────

export interface PluginConfigField {
  type: "string" | "number" | "boolean" | "select";
  default: unknown;
  description: string;
  options?: string[];  // for select
  secret?: boolean;    // render as password input
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: string[];
  defaultEnabled?: boolean;
  contributes?: {
    configuration?: Record<string, PluginConfigField>;
  };
}
