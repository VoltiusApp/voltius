import type { ReactNode } from "react";
import type { SerialConnectParams } from "@/types";
import type { AppTheme } from "@/themes/types";
import type { Locale } from "@/stores/localeStore";
import type { PluginAuditAction } from "@/services/auditContext";

export type { PluginAuditAction } from "@/services/auditContext";

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
  // Display-only fields — already present at runtime (runtime.ts:389 returns
  // full Connection records cast to PluginConnection[]); exposed here so the
  // agent UI can render a real per-host avatar. Optional and additive.
  connection_type?: "ssh" | "serial" | "ftp";
  icon?: string;
  distro?: string;
  serial_port?: string;
  /**
   * True when this connection is owned by a team vault rather than the user's
   * personal store. `update` and `delete` reject one; a `vault_id` does NOT
   * imply it, since a personal connection can live in a local vault too.
   */
  team?: boolean;
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
  tags: string[];
}

export interface PluginIdentity {
  id: string;
  name?: string;
  username: string;
  key_id?: string;
  tags: string[];
}

/** A vault the user organizes objects into. Unrelated to `api.vault`, which is plugin storage. */
export interface PluginVault {
  id: string;
  name: string;
  /** Backed by a team; every write verb refuses it. */
  team: boolean;
}

/** The four folder trees the app has. One `keychain` tree holds keys AND identities. */
export type PluginFolderKind = "connection" | "keychain" | "port_forwarding" | "snippet";

export interface PluginFolder {
  id: string;
  name: string;
  kind: PluginFolderKind;
  vaultId: string;
  parentFolderId: string | null;
  team: boolean;
}

/**
 * One relocation of vault objects: the same operation a cut/copy + paste is on
 * the page, so the ids must all belong to one tab (hosts, keychain, port
 * forwarding or snippets). Folder ids may travel with them, contents included.
 */
export interface PluginObjectMoveInput {
  ids: string[];
  /** Destination folder, or null for the destination vault's root. */
  folderId: string | null;
  /** Destination vault. null keeps every object in the vault it has. */
  vaultId: string | null;
  /**
   * Authorizes a destination vault other than the objects' own. Without it a
   * crossing is refused before anything is written, and the refusal carries the
   * plan — how many objects, which vault, and what would travel with them.
   */
  allowCrossVault?: boolean;
}

export interface PluginObjectMoveOutcome {
  moved: number;
  created: number;
  /** Ids that no longer exist, or objects already where the call would put them. */
  skipped: number;
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

/** A label that may be a function, re-resolved by the host on locale change.
 *  A plain string is frozen at registration time. */
export type PluginLabel = string | (() => string);

export interface SettingsPage {
  id: string;
  label: PluginLabel;
  icon: string;
  component: React.FC;
}

export interface RightPanelSection {
  id: string;
  label: PluginLabel;
  icon: string;
  component: React.FC;
  /** Opt-in: this section drives the terminal status bar's high-CPU indicator
   *  and its metrics stream. Explicit flag rather than an id check, so a plugin
   *  can't inherit the host integration by squatting another plugin's section id. */
  providesHostMetrics?: boolean;
  /** Opt-in: this section owns an in-panel search bar that Ctrl+F should focus
   *  when the section is open, via the "voltius:focus-panel-search" event. */
  providesPanelSearch?: boolean;
  /** Rail position, ascending. Sections without one sort last; ties break on `id`.
   *  Registration order is NOT stable — it follows the on-disk read order of the
   *  seeded plugin directory and changes after any uninstall/reinstall — so a
   *  section that wants a fixed rail slot must declare it here. */
  order?: number;
}

/** Nav-stack entries a plugin may push via `pushMobileScreen`. Each member's
 *  `kind` must exist as a "panel-<kind>" variant of mobileNavCore's MobileScreen
 *  union — runtime.ts's translator switch is exhaustively checked against that
 *  union, so adding a member here without a matching host variant is a type
 *  error, not a silent no-op at runtime. */
export type PluginMobileNavEntry = {
  kind: "docker-logs";
  sessionId: string;
  containerId: string;
  containerName: string;
};

/** Props the host passes into a registered mobile screen's `render`. Extra
 *  navigation params (e.g. docker-logs' containerId/containerName) ride along
 *  as additional keys — see `pushMobileScreen`. */
export interface MobileScreenProps {
  sessionId: string;
  /** Pop this screen off the mobile nav stack. MobilePanelHeader itself can't
   *  cross the plugin boundary (it reaches into the host's nav store), so the
   *  screen must render its own header chrome and wire this to its back button. */
  onBack: () => void;
  [key: string]: unknown;
}

export interface MobileScreen {
  id: string;
  /** Screen key MobileShell looks up on navigation, e.g. "docker", "metrics". */
  kind: string;
  render: React.FC<MobileScreenProps>;
}

export interface GlobalPanel {
  id: string;
  /** Rendered at shell level (not session-scoped). Host drives open/close. */
  component: React.FC<{ open: boolean; onClose: () => void }>;
}

/** Controls the panel it was returned from. Calling it disposes, as before. */
export interface GlobalPanelHandle {
  (): void;
  /** Host-prefixed id, e.g. "ai-agent:drawer". */
  readonly id: string;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Width (px) the app shell reserves while this panel is docked. */
  setDockedWidth(width: number): void;
}

export interface PluginSession {
  id: string;
  connectionId: string;
  connectionName: string;
  status: string;
  type: string;
  /** Local sessions only: the shell path/name to use for a spawned exec PTY. */
  localShell?: string;
}

// ─── Files (SFTP / FTP / local) ────────────────────────────────────────────

/**
 * What a file operation acts on: a saved connection's id, or the literal
 * "local" for this machine. SFTP and FTP connections are both addressed this
 * way — the host opens whichever transport the connection declares.
 */
export type FileTarget = string;

export interface FileEndpoint {
  target: FileTarget;
  path: string;
}

export interface PluginFile {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  isSymlink: boolean;
  /** Unix seconds, or null when the transport does not report one. */
  modified: number | null;
}

/**
 * Remote and local file access. Reads are gated on "sftp:read", everything that
 * writes, moves or removes on "sftp:write".
 */
export interface SftpAPI {
  list(target: FileTarget, path: string): Promise<PluginFile[]>;
  /** Null when the path does not exist — not an error. */
  stat(target: FileTarget, path: string): Promise<PluginFile | null>;
  readText(target: FileTarget, path: string, maxBytes?: number): Promise<string>;
  writeText(target: FileTarget, path: string, content: string): Promise<void>;
  mkdir(target: FileTarget, path: string): Promise<void>;
  rename(target: FileTarget, from: string, to: string): Promise<void>;
  delete(target: FileTarget, path: string): Promise<void>;
  /** Copy one path between any two targets, in any direction, files or
   *  directories. Host→host streams directly and never lands on this machine. */
  transfer(src: FileEndpoint, dst: FileEndpoint): Promise<void>;
  /** Release the handle held for `target`, if any. */
  disconnect(target: FileTarget): Promise<void>;
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
  | "portForwardingRule.contextMenu"
  | "home.bgContextMenu"
  | "keychain.bgContextMenu"
  | "home.toolbar.hostMenu"
  | "settings.vaults";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UIContributionFactory = (ctx: any) => ContributedAction[];

export type UIStatusBarSlot = "terminal.statusBar.right" | "titlebar.right";

export interface TerminalStatusBarContributionContext {
  sessionId: string;
  sessionType: "ssh" | "local" | "serial";
  connectionId: string;
  connectionName?: string;
  sessionStatus: "connecting" | "connected" | "disconnected" | "error";
  connection?: PluginConnection;
  serialConfig?: SerialConnectParams;
  dimensions?: { cols: number; rows: number };
}

export type UIStatusBarContributionFactory = (ctx: TerminalStatusBarContributionContext) => ReactNode;

export type StreamKind = "metrics" | "processes" | "docker-logs" | "docker-stack-logs";

export interface StreamsAPI {
  /** Start a session-scoped stream. Returns a streamId. */
  start(kind: StreamKind, opts: Record<string, unknown>): Promise<string>;
  /** Stop a stream. No-op for an unknown id. */
  stop(streamId: string): Promise<void>;
  /** Subscribe to a started stream's snapshots. Resolves to an unsubscribe fn. */
  on<T>(streamId: string, cb: (snapshot: T) => void): Promise<() => void>;
}

/** Host metrics — built on top of api.streams' "metrics" kind. GATED (metrics:read). */
export interface MetricsAPI {
  start(sessionId: string, isRemote: boolean): Promise<string>;
  stop(streamId: string): Promise<void>;
  onSnapshot<T>(streamId: string, cb: (snapshot: T) => void): Promise<() => void>;
  getSystemInfo(sessionId: string, sessionType: string, sessionName?: string): Promise<unknown>;
}

/** Process listing/kill — built on top of api.streams' "processes" kind. GATED, split
 *  two ways: processes:read covers start/onSnapshot/stop; processes:manage covers kill. */
export interface ProcessesAPI {
  start(sessionId: string, isRemote: boolean): Promise<string>;
  stop(streamId: string): Promise<void>;
  onSnapshot<T>(streamId: string, cb: (snapshot: T) => void): Promise<() => void>;
  kill(sessionId: string, pid: number, isRemote: boolean, force: boolean): Promise<void>;
}

/** Not gated — a pure KDF over caller-supplied input, grants no access to host secrets. */
export interface CryptoAPI {
  /** Derive a 32-byte key from a passphrase and hex salt. Returns hex. */
  deriveKey(passphrase: string, saltHex: string): Promise<string>;
}

/** Locales the host ships. A plugin's catalog may cover any subset — "en" should
 *  always be present, since it is the fallback when the active locale is missing.
 *  Re-exports the host's own `Locale` union (type-only, erased at build — this
 *  doesn't pull `@/stores/localeStore` into the plugin bundle) so a future host
 *  locale addition flows through here automatically instead of drifting out of sync. */
export type PluginLocale = Locale;

/** A flat key → template map for one locale. Values may contain "{{var}}" placeholders. */
export type PluginLocaleCatalog = Record<string, string>;

export type PluginI18nCatalog = Partial<Record<PluginLocale, PluginLocaleCatalog>>;

/**
 * Not gated — reading/resolving UI strings grants no host access. Each plugin owns
 * its own catalog (registered here, not in the host's locale files) so a third-party
 * plugin can ship translations exactly the way a first-party one does.
 */
export interface I18nAPI {
  /** Register (or replace) this plugin's translation catalog. Call once at load,
   *  before rendering anything that resolves keys. */
  register(catalog: PluginI18nCatalog): void;
  /** Resolve `key` against the host's active locale. Falls back to the "en" entry,
   *  then to `key` itself (visible, never blank) if neither has it. */
  t(key: string, vars?: Record<string, string | number>): string;
  /** The host's current active locale. */
  getLocale(): PluginLocale;
  /** Fires whenever the host's active locale changes. Re-call `t()` and re-render
   *  on each firing — this does not itself trigger a React re-render. Returns an
   *  unsubscribe function. */
  onLocaleChange(cb: (locale: PluginLocale) => void): () => void;
}

/** Proxmox VE LXC management. GATED, split two ways: proxmox:read covers
 *  list/snapshots.list; proxmox:manage covers everything else. Only functions
 *  against SSH sessions. */
export interface ProxmoxAPI {
  lxc: {
    list(sessionId: string): Promise<unknown[]>;
    action(sessionId: string, vmid: number, action: string): Promise<void>;
    /** Opens a pct-exec shell into the container and returns the new session's id.
     *  vmName is display-only — used for the resulting terminal tab's label. */
    openShell(sessionId: string, vmid: number, vmName?: string): Promise<string>;
    snapshots: {
      list(sessionId: string, vmid: number): Promise<unknown[]>;
      create(sessionId: string, vmid: number, name: string, description?: string): Promise<void>;
      rollback(sessionId: string, vmid: number, name: string): Promise<void>;
      remove(sessionId: string, vmid: number, name: string): Promise<void>;
    };
  };
}

/** Where a docker command runs. Replaces the repeated (sessionId, isRemote, localShell)
 *  triple the underlying commands take — a transposed boolean in a positional call is
 *  silent; this shape makes every call site self-describing and tsc-checked. */
export interface DockerTarget {
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
}

/**
 * Docker container/image/volume/network/stack management. GATED, split two ways
 * (kipavy ruling): docker:read covers every list/services/checkUpdate verb and all
 * of logs.*; docker:manage covers everything that mutates or destroys, including
 * exec.open (an interactive shell inside a container is full control, not a read).
 */
export interface DockerAPI {
  containers: {
    list(t: DockerTarget): Promise<unknown[]>;
    action(t: DockerTarget, containerId: string, action: string): Promise<void>;
    /** Reconstructs the `docker run` command for the container. `command` is the
     *  container's image ref, passed through to the backend command as `image`. */
    runCommand(t: DockerTarget, containerId: string, command: string): Promise<string>;
  };
  images: {
    list(t: DockerTarget): Promise<unknown[]>;
    remove(t: DockerTarget, imageId: string): Promise<void>;
    pull(t: DockerTarget, image: string): Promise<void>;
    checkUpdate(t: DockerTarget, imageId: string): Promise<unknown>;
    /** Pulls `image` and, when `recreate` is set, recreates the containers using it. */
    update(t: DockerTarget, imageId: string, recreate: boolean): Promise<unknown>;
    recreateContainers(t: DockerTarget, imageId: string): Promise<unknown>;
    prune(t: DockerTarget): Promise<string>;
  };
  volumes: {
    list(t: DockerTarget): Promise<unknown[]>;
    remove(t: DockerTarget, name: string): Promise<void>;
    prune(t: DockerTarget): Promise<string>;
  };
  networks: {
    list(t: DockerTarget): Promise<unknown[]>;
    remove(t: DockerTarget, id: string): Promise<void>;
    prune(t: DockerTarget): Promise<string>;
  };
  stacks: {
    list(t: DockerTarget): Promise<unknown[]>;
    services(t: DockerTarget, stack: string): Promise<unknown[]>;
    action(t: DockerTarget, stack: string, action: string): Promise<void>;
    update(t: DockerTarget, stack: string): Promise<void>;
  };
  logs: {
    start(t: DockerTarget, containerId: string, tail: number): Promise<string>;
    startStack(t: DockerTarget, stack: string, tail: number): Promise<string>;
    stop(streamId: string): Promise<void>;
    /** Payload is a DockerLogLine ({ line, stream }), not a bare string — kept generic like StreamsAPI.on. */
    on<T>(streamId: string, cb: (payload: T) => void): Promise<() => void>;
  };
  system: { prune(t: DockerTarget): Promise<string> };
  exec: {
    /** Opens an interactive shell into the container and returns the new session's id.
     *  containerName is display-only — used for the resulting terminal tab's label. */
    open(t: DockerTarget, containerId: string, containerName?: string): Promise<string>;
  };
}

/** A local audit row, projected. Drops the internal id, actor id, team/vault
 *  ids and IP — none of which a plugin or an external client has any use for. */
export interface PluginAuditRow {
  action: string;
  actor_name: string;
  source: "server" | "client";
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PluginAuditQuery {
  actions?: string[];
  /** ISO 8601. */
  from?: string;
  to?: string;
  page?: number;
  /** Clamped to 100. */
  perPage?: number;
}

/** One MCP tool a plugin contributes. The host namespaces the name, validates
 *  everything here at registration, and audits calls unless `mutating` is false. */
export interface McpToolContribution {
  /** Unqualified, matching /^[a-z0-9_]+$/. The host adds the namespace prefix. */
  name: string;
  description: string;
  /** Plain JSON Schema. Converted host-side with the host's own zod, so no zod
   *  instance crosses the bundle boundary. */
  inputSchema: Record<string, unknown>;
  /** Whether a call changes state. Defaults to true: forgetting the field
   *  audits rather than silently not auditing. */
  mutating?: boolean;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/** Contribute tools to the Voltius MCP server. GATED (mcp:contribute). */
export interface McpAPI {
  /** Register this plugin's whole tool set. Throws on any invalid tool and
   *  registers none of them. Returns a teardown that removes the whole set. */
  registerTools(tools: McpToolContribution[]): () => void;
}

// ─── API principale ────────────────────────────────────────────────────────

export interface PluginAPI {
  pluginId: string;
  /** Returns true if this plugin is currently enabled in the registry. */
  isActive(): boolean;

  // SSH keys (requires keys:*)
  keys: {
    list(): Promise<PluginKey[]>;
    /** Creates a key entry and stores private/public content in the vault. */
    create(data: { name?: string; key_type?: string; tags?: string[] }, privateKey: string, publicKey?: string): Promise<PluginKey>;
    delete(id: string): Promise<void>;
    /** Appends the key's public half to a connection's authorized_keys over SSH.
     *  Requires keys:read and connections:read. Never accepts a script. */
    addToHost(input: { keyId: string; connectionId: string; location?: string; filename?: string }): Promise<void>;
  };

  // Identities (requires identities:*)
  identities: {
    list(): Promise<PluginIdentity[]>;
    create(data: { name?: string; username: string; key_id?: string; tags?: string[] }): Promise<PluginIdentity>;
    delete(id: string): Promise<void>;
  };

  // Connections (requires connections:*)
  connections: {
    /**
     * Every connection the user can reach, personal and team-vault alike. A
     * team-owned entry carries `team: true`; it is addressable exactly like a
     * personal connection for reads and for opening a session.
     */
    list(): Promise<PluginConnection[]>;
    get(id: string): Promise<PluginConnection | null>;
    create(data: PluginConnectionInput): Promise<PluginConnection>;
    /** Rejects a team-vault connection: team objects are not editable through this API. */
    update(id: string, data: Partial<PluginConnectionInput>): Promise<void>;
    /** Rejects a team-vault connection: team objects are not deletable through this API. */
    delete(id: string): Promise<void>;
    bulkImport(items: PluginConnectionInput[]): Promise<PluginConnection[]>;
    subscribe(cb: (connections: PluginConnection[]) => void): () => void;
  };

  // The user's vaults (requires the gated vaults:*). Note the plural: `vault`
  // below is this plugin's own secret storage and is a different thing.
  vaults: {
    list(): PluginVault[];
    create(name: string): PluginVault;
    /** Rejects a team vault. */
    rename(id: string, name: string): void;
    /**
     * Rejects the personal vault, a team vault, and a vault that still holds
     * objects unless `cascade` is passed — in which case its contents are
     * deleted with it.
     */
    delete(id: string, opts?: { cascade?: boolean }): Promise<void>;
  };

  // Folders across all four trees (requires the gated folders:*)
  folders: {
    list(kind?: PluginFolderKind): PluginFolder[];
    create(input: {
      kind: PluginFolderKind;
      name: string;
      /** Defaults to the personal vault. */
      vaultId?: string;
      parentFolderId?: string;
    }): Promise<PluginFolder>;
    /** Name only — kind, vault and parent are preserved. Rejects a team vault. */
    rename(id: string, name: string): Promise<void>;
    /** Cascades by default. Rejects a team vault. */
    delete(id: string, opts?: { cascade?: boolean }): Promise<void>;
  };

  /**
   * Move and copy vault objects between folders and vaults, through the same
   * paste path the pages use. Each method requires the write permission of every
   * kind it names, and folders:write when a folder travels. Team vaults are
   * refused.
   */
  objects: {
    move(input: PluginObjectMoveInput): Promise<PluginObjectMoveOutcome>;
    copy(input: PluginObjectMoveInput): Promise<PluginObjectMoveOutcome>;
  };

  // Vault — plugin-scoped secrets (requires vault:*)
  vault: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Audit — record what this plugin did (requires "audit"); read this device's
  // log (requires the gated "audit:read")
  audit: {
    /**
     * Record an action against the connection it targets. A team-vault
     * connection additionally posts to that team's server; "local", unknown
     * and deleted ids fail closed to the on-device sink.
     *
     * `localMetadata` never leaves the device. Never pass captured terminal
     * output to either channel.
     */
    record(
      connectionId: string | null,
      action: PluginAuditAction,
      metadata?: Record<string, unknown>,
      localMetadata?: Record<string, unknown>,
    ): void;
    /** This device's local rows only. Team-vault rows are server-backed and
     *  are not returned here. */
    query(filters: PluginAuditQuery): Promise<{ logs: PluginAuditRow[]; total: number }>;
  };

  // Themes (requires "themes")
  themes: {
    register(theme: PluginTheme): void;
    unregister(id: string): void;
  };

  // OmniSearch (requires "omni-commands")
  omni: {
    register(command: OmniCommand): () => void;
    unregister(id: string): void;
  };

  // UI — extension points
  ui: {
    registerSettingsPage(page: SettingsPage): () => void;
    registerRightPanelSection(section: RightPanelSection): () => void;
    /** Mount a global, shell-level panel (not session-scoped). Returns cleanup. */
    registerGlobalPanel(panel: GlobalPanel): GlobalPanelHandle;
    /** Contribute a full-screen mobile view for `screen.kind`. Uninstalling or
     *  disabling the plugin removes it, same as registerRightPanelSection does
     *  on desktop. Returns cleanup. */
    registerMobileScreen(screen: MobileScreen): () => void;
    /** Push another mobile screen onto the nav stack (e.g. docker's container
     *  list pushing its logs view). Writes to the mobile nav store regardless
     *  of platform — harmless on desktop, since MobileShell is never mounted
     *  there. */
    pushMobileScreen(entry: PluginMobileNavEntry): void;
    /** Switch the mobile shell to its terminal tab — e.g. after opening an exec
     *  shell. Writes to the mobile nav store regardless of platform — harmless
     *  on desktop, since MobileShell is never mounted there. */
    focusMobileTerminal(): void;
    /** Inject action items into a named UI slot. Returns a cleanup function. */
    registerContribution<C = unknown>(slot: UISlot, fn: (ctx: C) => ContributedAction[]): () => void;
    /** Render a React widget in the terminal status bar's right-side slot. Returns a cleanup function. */
    registerStatusBarItem(slot: UIStatusBarSlot, fn: UIStatusBarContributionFactory): () => void;
    unregister(id: string): void;
    /** Switch the app's active navigation section. */
    setActiveNav(id: string): void;
    /** Publish a plain, serialisable state snapshot for host UI to read, keyed
     *  by `<pluginId>::<key>`. Host surfaces subscribe to this instead of
     *  importing the plugin's runtime module. Cleared on unload/disable. */
    publishState(key: string, value: unknown): void;
  };

  // Plugin-scoped key-value storage
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // HTTP (requiert "http")
  http: {
    get<T>(url: string, opts?: RequestInit): Promise<T>;
    post<T>(url: string, body: unknown, opts?: RequestInit): Promise<T>;
    /** Streaming request. Returns a Response with a ReadableStream body (for SSE/LLM streaming). */
    stream(url: string, init?: RequestInit): Promise<Response>;
  };

  // Filesystem restricted to home (requires "fs")
  fs: {
    readText(path: string): Promise<string>;
    writeText(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    /** Polling-based file watch. Calls cb when content changes. Returns cleanup fn. */
    watch(path: string, cb: () => void, opts?: { intervalMs?: number }): () => void;
  };

  // Event bus (always available)
  events: {
    on(event: string, handler: (data: unknown) => void): () => void;
    emit(event: string, data?: unknown): void;
  };

  // Notifications (requires "notifications")
  notifications: {
    toast(message: string, opts?: ToastOptions): void;
    progress(title: string, opts?: ProgressOptions): ProgressHandle;
    banner(message: string, opts?: BannerOptions): BannerHandle;
  };

  // Plugin-scoped logger
  log: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };

  // Sessions (requires sessions:read / sessions:write)
  sessions: {
    /** Returns current sessions snapshot. */
    list(): PluginSession[];
    /** The session backing the active terminal tab, or null if there is none. */
    getActive(): PluginSession | null;
    /** Fires when a session becomes connected. */
    onConnected(cb: (session: PluginSession) => void): () => void;
    /** Fires when a connected session is removed or disconnected. */
    onDisconnected(cb: (session: PluginSession) => void): () => void;
    /** Fires when the user switches to a different terminal tab. */
    onActivated(cb: (session: PluginSession) => void): () => void;
    /** Send a command to a session. Runtime appends \n. Requires sessions:write. */
    sendCommand(sessionId: string, cmd: string): Promise<void>;
    /** Open (connect) a saved connection by id. Resolves to the new sessionId. Requires sessions:write. */
    open(connectionId: string): Promise<string>;
    /** Close (disconnect) a session by id. Requires sessions:write. */
    close(sessionId: string): Promise<void>;
  };

  // Terminal output — GATED (first-party only). Requires terminal:read / terminal:stream.
  terminal: {
    /** Last `maxLines` lines of a session's buffer as text (default 200). */
    readSnapshot(sessionId: string, maxLines?: number): string;
    /** The session's current selection as text, or "" if nothing is selected. */
    readSelection(sessionId: string): string;
    /** Subscribe to live decoded output for a session. Resolves to an unsubscribe fn. */
    onOutput(sessionId: string, cb: (text: string) => void): Promise<() => void>;
  };

  // Keychain — GATED (first-party only). OS-local, never synced.
  // Requires keychain:read / keychain:write.
  keychain: {
    /** Read a value from the OS keychain. Returns null if unset. */
    get(key: string): Promise<string | null>;
    /** Write a value to the OS keychain. */
    set(key: string, value: string): Promise<void>;
    /** Delete a value from the OS keychain (no-op if absent). */
    delete(key: string): Promise<void>;
  };

  // Session-scoped streams (metrics, processes, docker logs) — GATED per kind.
  streams: StreamsAPI;

  // Host metrics domain wrapper over streams — GATED (metrics:read).
  metrics: MetricsAPI;

  // Process listing/kill domain wrapper over streams — GATED, split
  // processes:read (start/onSnapshot/stop) / processes:manage (kill).
  processes: ProcessesAPI;

  // Key derivation (requires crypto:derive). Not gated — pure KDF over caller input.
  crypto: CryptoAPI;

  // Plugin-owned UI translation catalog (requires "ui"). Not gated.
  i18n: I18nAPI;

  // Proxmox VE LXC management — GATED, split
  // proxmox:read (list/snapshots.list) / proxmox:manage (everything else).
  // Files over SFTP/FTP and the local disk — GATED, split
  // sftp:read (list/stat/readText) / sftp:write (everything that mutates).
  sftp: SftpAPI;

  proxmox: ProxmoxAPI;

  // Docker container/image/volume/network/stack management — GATED, split
  // docker:read (list/services/checkUpdate/logs.*) / docker:manage (everything else).
  docker: DockerAPI;

  // Lifecycle hooks (always available)
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

  // Sync / blob storage (requires sync:read / sync:write)
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
     * base64-encoded XChaCha20-Poly1305 encrypted blob — same format as cloud sync.
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

  // Inter-plugin communication (always available)
  plugins: {
    /** Publish this plugin's public API surface so other plugins can consume it. */
    expose(publicApi: unknown): void;
    /** Get another plugin's exposed API. Returns null if not loaded or not exposed. */
    getApi(pluginId: string): unknown | null;
  };

  // MCP tool contributions — GATED (mcp:contribute). Tools run with THIS
  // plugin's permissions, called by whatever external agent the user connected.
  mcp: McpAPI;
}

export type PluginRegisterFn = (api: PluginAPI) => (() => void) | void;

// ─── Settings schema ───────────────────────────────────────────────────────

export interface PluginConfigField {
  type: "string" | "number" | "boolean" | "select";
  default: unknown;
  description: string;
  /** Overrides the auto-derived label (the host humanizes the key by default). */
  label?: string;
  options?: string[];  // for select
  secret?: boolean;    // render as password input
  min?: number;        // for number: minimum (also clamps on save)
  max?: number;        // for number: maximum (also clamps on save)
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Minimum app version required to run this plugin. Falls back to the app version
   *  at build time when the manifest omits it. */
  minAppVersion?: string;
  description?: string;
  permissions: string[];
  defaultEnabled?: boolean;
  /** Hidden in the plugin list on mobile (uses host-only resources, e.g. local fs). */
  desktopOnly?: boolean;
  contributes?: {
    configuration?: Record<string, PluginConfigField>;
  };
}
