import { create } from "zustand";
import type { Connection, TerminalSession, SerialConnectParams } from "@/types";

/**
 * Auth/username supplied through the connection overlay when a host is missing
 * credentials. Mirrors the connection form's choices: an existing identity, an
 * existing key, or inline password / private key material.
 */
export interface ConnectRetryOverride {
  username?: string;
  identityId?: string | null;
  keyId?: string | null;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}
import { sshConnect, sshDisconnect, sshDetectDistro, sshSendInput } from "@/services/ssh";
import { resolveKeepalive } from "@/utils/keepalive";
import { resolveDisableOverride } from "@/utils/inheritedSetting";
import { getGlobalKeepalivePreset, resolvePersistSession } from "@/stores/connectivitySettingsStore";
import { localConnect, localDisconnect } from "@/services/local";
import { serialConnect, serialDisconnect } from "@/services/serial";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { storeSecret, getSecret } from "@/services/vault";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import { useIdentityStore } from "@/stores/identityStore";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAuditClientEvent, type ClientAuditAction } from "@/services/auditReporter";
import { useConnectionStore, connectionToFormData } from "./connectionStore";
import { useUIStore } from "./uiStore";
import { useTerminalSettingsStore } from "./terminalSettingsStore";
import { getToggle } from "./toggleSettingsStore";
import { useLayoutStore } from "./layoutStore";
import { useTerminalCwdStore } from "./terminalCwdStore";
import { usePanelSftpStore } from "./panelSftpStore";
import { formatLocalShellTitle } from "@/utils/localShellTitle";
import { cancelBackoff } from "./reconnectBackoffCore";

interface SessionStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  connect: (connectionId: string) => Promise<void>;
  connectMany: (connectionIds: string[]) => Promise<string[]>;
  connectDirect: (connection: Connection) => Promise<void>;
  connectLocal: () => Promise<void>;
  connectLocalAt: (cwd: string) => Promise<void>;
  beginLocalSession: (shell?: string) => string;
  connectAt: (connectionId: string, cwd: string) => Promise<void>;
  connectSerial: (connectionId: string) => Promise<void>;
  connectSerialEphemeral: (initialPort?: string) => Promise<void>;
  connectSerialEphemeralFinalize: (sessionId: string, params: SerialConnectParams) => Promise<void>;
  resetSerialEphemeral: (sessionId: string) => void;
  disconnect: (sessionId: string) => Promise<void>;
  setActive: (sessionId: string) => void;
  markDisconnected: (sessionId: string) => void;
  markConnecting: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  reconnect: (sessionId: string, options?: { restore?: boolean }) => Promise<void>;
  /** Silent reconnect for the auto-backoff loop: performs the same connect as
   * reconnect() but mutates no visible status, returning the outcome so the loop
   * can hold a single steady "reconnecting" state and decide what to surface. */
  reconnectAttempt: (sessionId: string) => Promise<{ ok: boolean; errorMessage?: string }>;
  reconnectWithPassphrase: (sessionId: string, passphrase: string, save: boolean) => Promise<void>;
  retryConnect: (sessionId: string, override: ConnectRetryOverride, save: boolean) => Promise<void>;
  restoreSessions: (sessions: TerminalSession[], activeSessionId: string | null) => void;
  markConnected: (sessionId: string) => void;
  markError: (sessionId: string, message: string) => void;
}

type SessionSetter = (fn: (s: { sessions: TerminalSession[]; activeSessionId: string | null }) => Partial<SessionStore>) => void;

// Quick-connect (ephemeral) connections are never written to the connection
// store, so retry/reconnect paths that look a connection up by id would
// otherwise fail to find them. Registered on connectDirect, cleared on
// removeSession.
const ephemeralConnections = new Map<string, Connection>();

function findConnection(connectionId: string): Connection | undefined {
  const { connections, teamConnections } = useConnectionStore.getState();
  return (
    connections.find((c) => c.id === connectionId) ??
    Object.values(teamConnections).flat().find((c) => c.id === connectionId) ??
    ephemeralConnections.get(connectionId)
  );
}

function reportConnectionAudit(connection: Connection, action: ClientAuditAction): void {
  reportAuditClientEvent(auditContextForVaultId(connection.vault_id), action, {
    target_type: "connection",
    target_id: connection.id,
    target_name: connection.name?.trim() || `${connection.username}@${connection.host}:${connection.port}`,
  });
}

async function buildSshConnectOptions(
  connection: Connection,
  sessionId: string,
): Promise<{
  jumpHosts: Awaited<ReturnType<typeof resolveJumpHosts>> | undefined;
  envVars: [string, string][] | undefined;
  agentForwarding: boolean;
  preCommand: string | undefined;
  autoForward: boolean;
  shellIntegration: boolean;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
  persist: boolean;
  cols?: number;
  rows?: number;
}> {
  const jumpHosts = await resolveJumpHosts(connection);
  const envVars = connection.env_vars?.map((e): [string, string] => [e.key, e.value]) ?? [];
  const { intervalSecs, max } = resolveKeepalive(connection.keepalive_preset ?? getGlobalKeepalivePreset());

  let dims: { cols: number; rows: number } | Record<string, never> = {};
  try {
    const { getTerminalDims } = await import("@/hooks/useTerminal");
    dims = getTerminalDims(sessionId) ?? {};
  } catch {
    dims = {};
  }

  return {
    jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
    envVars: envVars.length > 0 ? envVars : undefined,
    agentForwarding: connection.agent_forwarding ?? false,
    preCommand: connection.pre_command ?? undefined,
    autoForward: getToggle("auto-forward"),
    shellIntegration: resolveDisableOverride(connection.shell_integration_disabled, getToggle("shell-integration")),
    keepaliveIntervalSecs: intervalSecs,
    keepaliveMax: max,
    persist: resolvePersistSession(connection.persist_session),
    ...dims,
  };
}

async function startSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
  password?: string,
  privateKey?: string,
  passphrase?: string,
) {
  createSshSession(set, connection, sessionId);
  await connectSshSession(set, connection, sessionId, password, privateKey, passphrase);
}

function createSshSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
) {
  const session: TerminalSession = {
    id: sessionId,
    connectionId: connection.id,
    connectionName: connection.name?.trim() || `${connection.username}@${connection.host}:${connection.port}`,
    status: "connecting",
    persist: resolvePersistSession(connection.persist_session),
    type: "ssh",
    encoding: connection.terminal_encoding,
  };

  set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
  useLayoutStore.getState().setSplitTabActive(false);
}

/**
 * Validate that a host has the minimum needed to attempt an SSH connection.
 * Returns a sentinel error message (detected by the connection overlay to show
 * the username / auth prompt) or null when the connection can proceed.
 *
 * `hasConfiguredAuth` lets a host that references a keychain identity or key be
 * treated as having auth even if the secret momentarily resolves empty (e.g.
 * identities not yet loaded). In that case we proceed and let the backend be the
 * authority — it returns "No authentication method provided" if there's truly
 * nothing, which surfaces the same prompt without false positives.
 */
function preflightConnect(
  username: string | undefined,
  password?: string,
  privateKey?: string,
  hasConfiguredAuth = false,
): string | null {
  if (!username || !username.trim()) return "No username provided";
  if (!password && !privateKey && !hasConfiguredAuth) return "No authentication method provided";
  return null;
}

/**
 * Serialize connect attempts per session id. The backoff loop's in-flight
 * attempt, a manual reconnect, and workspace restore can otherwise issue
 * concurrent sshConnect for one session — and if the remote `screen` is briefly
 * absent at that moment they race into duplicate (zombie) servers, since screen
 * has no name-collision protection. Chaining makes the second caller wait, so it
 * re-attaches the server the first created instead of spawning its own.
 */
const sessionConnectChains = new Map<string, Promise<unknown>>();
function withSessionConnectLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionConnectChains.get(sessionId) ?? Promise.resolve();
  // Run fn after prev settles either way — a failed prior attempt must not wedge the chain.
  const next = prev.then(fn, fn);
  sessionConnectChains.set(sessionId, next);
  const clear = () => {
    if (sessionConnectChains.get(sessionId) === next) sessionConnectChains.delete(sessionId);
  };
  void next.then(clear, clear);
  return next;
}

async function connectSshSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
  password?: string,
  privateKey?: string,
  passphrase?: string,
) {
  const hasConfiguredAuth = !!connection.identity_id || !!connection.key_id;
  const preflightError = preflightConnect(connection.username, password, privateKey, hasConfiguredAuth);
  if (preflightError) {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: preflightError } : sess,
      ),
    }));
    throw new Error(preflightError);
  }

  const opts = await buildSshConnectOptions(connection, sessionId);

  try {
    await withSessionConnectLock(sessionId, () =>
      sshConnect({
        sessionId,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password,
        privateKey,
        passphrase,
        connectionId: connection.id,
        ...opts,
      }),
    );
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "connected" as const, everConnected: true } : sess,
      ),
    }));

    useConnectionStore.getState().setLastUsed(connection.id).catch(() => {});
    reportConnectionAudit(connection, "connection.started");

    if (!connection.distro) {
      sshDetectDistro(sessionId)
        .then((distro) => useConnectionStore.getState().setDistro(connection.id, distro))
        .catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
      ),
    }));
    throw err;
  }
}

async function startSerialSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
) {
  const serialParams = createSerialSession(set, connection, sessionId);
  await connectSerialSession(set, connection, sessionId, serialParams);
}

function createSerialSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
) {
  const serialParams: SerialConnectParams = {
    sessionId,
    port: connection.serial_port ?? "",
    baud: connection.serial_baud ?? 115200,
    dataBits: connection.serial_data_bits,
    parity: connection.serial_parity,
    stopBits: connection.serial_stop_bits,
    flowControl: connection.serial_flow_control,
  };

  const session: TerminalSession = {
    id: sessionId,
    connectionId: connection.id,
    connectionName: connection.name?.trim() || connection.serial_port || "Serial",
    status: "connecting",
    type: "serial",
    serialConfig: serialParams,
  };

  set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
  useLayoutStore.getState().setSplitTabActive(false);

  return serialParams;
}

async function connectSerialSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
  serialParams: SerialConnectParams,
) {
  try {
    await serialConnect(serialParams);
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
      ),
    }));
    useConnectionStore.getState().setLastUsed(connection.id).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
      ),
    }));
  }
}

function markSessionError(set: SessionSetter, sessionId: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  set((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
    ),
  }));
}

// Auth/username supplied through the overlay, carried across the two-step prompt
// flow (username first, then auth) for a single session. Cleared on success.
const connectOverrides = new Map<string, ConnectRetryOverride>();

function findIdentityById(id: string) {
  const { identities, teamIdentities } = useIdentityStore.getState();
  return [...identities, ...Object.values(teamIdentities).flat()].find((i) => i.id === id);
}

interface ResolvedRetryAuth {
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/**
 * Resolve the effective credentials for a retry, layering the overlay-supplied
 * override on top of whatever the host already has stored.
 */
async function resolveOverrideAuth(connection: Connection, override: ConnectRetryOverride): Promise<ResolvedRetryAuth> {
  const base = await resolveConnectionCredentials(connection);
  let username = override.username?.trim() || base.username || connection.username;
  let password = base.password;
  let privateKey = base.privateKey;
  let passphrase = base.passphrase;

  if (override.identityId) {
    const identity = findIdentityById(override.identityId);
    if (identity) {
      username = identity.username;
      password = (await getSecret(`identity:${override.identityId}:password`).catch(() => null)) ?? undefined;
      privateKey = identity.key_id ? (await getSecret(`key:${identity.key_id}:private`).catch(() => null)) ?? undefined : undefined;
      passphrase = identity.key_id ? (await getSecret(`key:${identity.key_id}:passphrase`).catch(() => null)) ?? undefined : undefined;
    }
  } else if (override.keyId) {
    privateKey = (await getSecret(`key:${override.keyId}:private`).catch(() => null)) ?? undefined;
    passphrase = (await getSecret(`key:${override.keyId}:passphrase`).catch(() => null)) ?? undefined;
    password = undefined;
  } else if (override.password !== undefined || override.privateKey !== undefined || override.passphrase !== undefined) {
    password = override.password || undefined;
    privateKey = override.privateKey || undefined;
    passphrase = override.passphrase || undefined;
  }

  return { username, password, privateKey, passphrase };
}

/**
 * Persist overlay-supplied auth/username back onto the host config so future
 * connections succeed without prompting. Mirrors the connection form's save:
 * identity/key references go on the record, inline secrets go to the vault.
 */
async function persistConnectAuth(connection: Connection, override: ConnectRetryOverride): Promise<void> {
  const data = connectionToFormData(connection);

  if (override.username?.trim() && !override.identityId) {
    data.username = override.username.trim();
  }

  if (override.identityId) {
    const identity = findIdentityById(override.identityId);
    data.identity_id = override.identityId;
    data.key_id = undefined;
    data.auth_type = identity?.key_id ? "key" : "password";
  } else if (override.keyId) {
    data.identity_id = undefined;
    data.key_id = override.keyId;
    data.auth_type = "key";
  } else if (override.privateKey?.trim()) {
    data.identity_id = undefined;
    data.key_id = undefined;
    data.auth_type = "key";
    await storeSecret(`key:${connection.id}`, override.privateKey.trim());
    await saveTeamVaultSecretForVault(connection.vault_id, `key:${connection.id}`, override.privateKey.trim()).catch(() => {});
    if (override.passphrase) {
      await storeSecret(`passphrase:${connection.id}`, override.passphrase);
      await saveTeamVaultSecretForVault(connection.vault_id, `passphrase:${connection.id}`, override.passphrase).catch(() => {});
    }
  } else if (override.password) {
    data.identity_id = undefined;
    data.key_id = undefined;
    data.auth_type = "password";
    await storeSecret(`password:${connection.id}`, override.password);
    await saveTeamVaultSecretForVault(connection.vault_id, `password:${connection.id}`, override.password).catch(() => {});
  }

  await useConnectionStore.getState().updateConnection(connection.id, data);
}

function beginConnection(set: SessionSetter, connectionId: string): string {
  const connection = findConnection(connectionId);
  if (!connection) throw new Error("Connection not found");

  const sessionId = crypto.randomUUID();

  if (connection.connection_type === "serial") {
    const serialParams = createSerialSession(set, connection, sessionId);
    void connectSerialSession(set, connection, sessionId, serialParams);
    return sessionId;
  }

  createSshSession(set, connection, sessionId);
  void resolveConnectionCredentials(connection)
    .then((credentials) => {
      const resolvedConnection = { ...connection, username: credentials.username };
      return connectSshSession(set, resolvedConnection, sessionId, credentials.password, credentials.privateKey, credentials.passphrase);
    })
    .catch((err) => markSessionError(set, sessionId, err));

  return sessionId;
}

async function connectConnection(
  set: SessionSetter,
  connectionId: string,
  options: { keepFailedSession?: boolean } = {},
): Promise<string> {
  const connection = findConnection(connectionId);
  if (!connection) throw new Error("Connection not found");

  const sessionId = crypto.randomUUID();

  if (connection.connection_type === "serial") {
    await startSerialSession(set, connection, sessionId);
    return sessionId;
  }

  // Add the session synchronously before awaiting credentials so the TitleBar
  // guard (sessions.length === 0 → redirect to hosts) doesn't fire during the
  // async credential resolution window.
  createSshSession(set, connection, sessionId);

  try {
    const credentials = await resolveConnectionCredentials(connection);
    const sessionConnection = { ...connection, username: credentials.username };
    await connectSshSession(set, sessionConnection, sessionId, credentials.password, credentials.privateKey, credentials.passphrase);
  } catch (err) {
    // connectSshSession already marks the session as "error"; if the failure
    // happened earlier (e.g. credential resolution), mark it here so the
    // error overlay is shown rather than leaving the session stuck on "connecting".
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId && sess.status === "connecting"
          ? { ...sess, status: "error" as const, errorMessage: err instanceof Error ? err.message : String(err) }
          : sess,
      ),
    }));
    if (!options.keepFailedSession) throw err;
  }
  return sessionId;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  connect: async (connectionId) => {
    await connectConnection(set as SessionSetter, connectionId);
  },

  connectMany: async (connectionIds) => {
    const uniqueIds = [...new Set(connectionIds)];
    const sessionIds = uniqueIds.map((id) => beginConnection(set as SessionSetter, id));
    if (sessionIds.length === 0) throw new Error("No connections selected");
    return sessionIds;
  },

  connectDirect: async (connection) => {
    const sessionId = crypto.randomUUID();
    ephemeralConnections.set(connection.id, connection);
    await startSession(set as SessionSetter, connection, sessionId);
  },

  connectLocal: async () => {
    const sessionId = crypto.randomUUID();
    const preferredShell = useTerminalSettingsStore.getState().preferredShell;
    const session: TerminalSession = {
      id: sessionId,
      connectionId: "local",
      connectionName: formatLocalShellTitle(preferredShell),
      status: "connecting",
      type: "local",
      localShell: preferredShell ?? undefined,
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    useLayoutStore.getState().setSplitTabActive(false);
    try {
      await localConnect(sessionId, 80, 24, preferredShell ?? undefined, undefined, getToggle("shell-integration"));
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }));
      useUIStore.getState().setActiveNav("terminal");
      useUIStore.getState().setSidebarOpen(false);
    } catch (err) {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const } : sess,
        ),
      }));
      throw err;
    }
  },

  connectLocalAt: async (cwd: string) => {
    const sessionId = crypto.randomUUID();
    const preferredShell = useTerminalSettingsStore.getState().preferredShell;
    const session: TerminalSession = {
      id: sessionId,
      connectionId: "local",
      connectionName: formatLocalShellTitle(preferredShell),
      status: "connecting",
      type: "local",
      localShell: preferredShell ?? undefined,
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    useLayoutStore.getState().setSplitTabActive(false);
    try {
      await localConnect(sessionId, 80, 24, preferredShell ?? undefined, cwd, getToggle("shell-integration"));
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }));
      useUIStore.getState().setActiveNav("terminal");
      useUIStore.getState().setSidebarOpen(false);
    } catch (err) {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const } : sess,
        ),
      }));
      throw err;
    }
  },

  beginLocalSession: (shell) => {
    const sessionId = crypto.randomUUID();
    const session: TerminalSession = {
      id: sessionId,
      connectionId: "local",
      connectionName: formatLocalShellTitle(shell ?? null),
      status: "connecting",
      type: "local",
      localShell: shell ?? undefined,
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    useLayoutStore.getState().setSplitTabActive(false);
    void localConnect(sessionId, 80, 24, shell, undefined, getToggle("shell-integration")).then(() => {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }));
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
        ),
      }));
    });
    return sessionId;
  },

  connectAt: async (connectionId, cwd) => {
    await get().connect(connectionId);
    const sessionId = get().activeSessionId;
    if (sessionId) {
      // Brief delay so the shell prompt has time to appear before we send cd
      await new Promise((r) => setTimeout(r, 400));
      await sshSendInput(sessionId, new TextEncoder().encode(`cd "${cwd}"\r`));
    }
    useUIStore.getState().setActiveNav("terminal");
    useUIStore.getState().setSidebarOpen(false);
  },

  connectSerial: async (connectionId) => {
    const connection = findConnection(connectionId);
    if (!connection) throw new Error("Connection not found");

    const sessionId = crypto.randomUUID();
    await startSerialSession(set as SessionSetter, connection, sessionId);
    useUIStore.getState().setActiveNav("terminal");
    useUIStore.getState().setSidebarOpen(false);
  },

  connectSerialEphemeral: async (initialPort?: string) => {
    const sessionId = crypto.randomUUID();
    const session: TerminalSession = {
      id: sessionId,
      connectionId: "serial-ephemeral",
      connectionName: "Serial",
      status: "connecting",
      type: "serial",
      initialSerialPort: initialPort,
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    useLayoutStore.getState().setSplitTabActive(false);
    useUIStore.getState().setActiveNav("terminal");
    useUIStore.getState().setSidebarOpen(false);
  },

  connectSerialEphemeralFinalize: async (sessionId, params) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, serialConfig: params, status: "connecting" as const, errorMessage: undefined }
          : sess,
      ),
    }));
    try {
      await serialConnect(params);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
        ),
      }));
    }
  },

  resetSerialEphemeral: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, serialConfig: undefined, status: "connecting" as const, errorMessage: undefined }
          : sess,
      ),
    }));
  },

  disconnect: async (sessionId) => {
    cancelBackoff(sessionId);
    const session = get().sessions.find((s) => s.id === sessionId);
    if (session?.type === "local") {
      await localDisconnect(sessionId);
    } else if (session?.type === "serial") {
      await serialDisconnect(sessionId).catch(() => {});
    } else {
      const connection = session?.connectionId ? findConnection(session.connectionId) : undefined;
      const persist = !!session?.persist;
      const wasAttached = session?.status === "connected";
      // The tab closes immediately; kill/tombstone resolve in the background.
      // Shared sessions: another device listing this session means close only
      // detaches; otherwise the backend kills unless a client is still attached
      // there (host-side count), and confirms with the kill sentinel — only a
      // confirmed kill publishes the tombstone.
      void (async () => {
        let killed = false;
        try {
          let kill = true;
          if (persist) {
            const { otherDeviceListsSession } = await import("./crossDeviceSessionsStore");
            kill = !otherDeviceListsSession(sessionId);
          }
          killed = await sshDisconnect(sessionId, connection?.post_command, kill, wasAttached);
        } catch {
          // best effort; an unreachable host means nothing was killed
        }
        if (persist && killed) {
          const [{ useCrossDeviceSessionsStore }, { publishLiveSessionsNow }] = await Promise.all([
            import("./crossDeviceSessionsStore"),
            import("@/services/liveSessionPublisher"),
          ]);
          useCrossDeviceSessionsStore.getState().markClosed(sessionId);
          publishLiveSessionsNow();
        }
        if (connection) reportConnectionAudit(connection, "connection.ended");
      })();
    }
    const state = get();
    const remaining = state.sessions.filter((s) => s.id !== sessionId);
    set({
      sessions: remaining,
      activeSessionId:
        state.activeSessionId === sessionId
          ? (remaining[remaining.length - 1]?.id ?? null)
      : state.activeSessionId,
    });
    useLayoutStore.getState().removeSession(sessionId);
    useTerminalCwdStore.getState().clear(sessionId);
    usePanelSftpStore.getState().closeSession(sessionId);
  },

  setActive: (sessionId) => set({ activeSessionId: sessionId }),

  markDisconnected: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "disconnected" as const } : sess,
      ),
    })),

  // Steady "connecting" the auto-reconnect loop holds across attempts, so the
  // overlay shows the normal connection steps (TCP step spinning) instead of a
  // separate panel. Idempotent and clears any prior error.
  markConnecting: (sessionId) =>
    set((s) => {
      const sess = s.sessions.find((x) => x.id === sessionId);
      if (!sess || (sess.status === "connecting" && sess.errorMessage === undefined)) return s;
      return {
        sessions: s.sessions.map((x) =>
          x.id === sessionId ? { ...x, status: "connecting" as const, errorMessage: undefined } : x,
        ),
      };
    }),

  // Rehydrate the whole session list at launch (workspace restore). Replaces
  // state wholesale — only valid while the store is empty.
  restoreSessions: (sessions, activeSessionId) =>
    set(() => ({
      sessions,
      activeSessionId: activeSessionId ?? sessions[sessions.length - 1]?.id ?? null,
    })),

  markConnected: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, status: "connected" as const, errorMessage: undefined, everConnected: true }
          : sess,
      ),
    })),

  markError: (sessionId, message) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: message } : sess,
      ),
    })),

  reconnect: async (sessionId, options) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session || (session.type !== "ssh" && session.type !== "serial")) return;

    if (session.type === "serial" && session.serialConfig) {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connecting" as const, errorMessage: undefined } : sess,
        ),
      }));
      try {
        await serialConnect(session.serialConfig);
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
          ),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
          ),
        }));
      }
      return;
    }
    if (session.type === "serial") {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: "Serial port configuration not found" } : sess,
        ),
      }));
      return;
    }

    const connection = findConnection(session.connectionId);
    if (!connection) {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: "Connection config not found" } : sess,
        ),
      }));
      return;
    }

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "connecting" as const, errorMessage: undefined } : sess,
      ),
    }));

    try {
      await withSessionConnectLock(sessionId, async () => {
        await sshDisconnect(sessionId).catch(() => {});
        const credentials = await resolveConnectionCredentials(connection);
        const opts = await buildSshConnectOptions(connection, sessionId);
        await sshConnect({
          sessionId,
          host: connection.host,
          port: connection.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          passphrase: credentials.passphrase,
          connectionId: connection.id,
          restore: options?.restore ?? false,
          attachOnly: !!(session.persist && session.everConnected),
          ...opts,
        });
      });
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const, everConnected: true } : sess,
        ),
      }));
      reportConnectionAudit(connection, "connection.started");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SESSION_ENDED")) {
        const { sessionEnded } = await import("@/services/crossDeviceSessions");
        sessionEnded(sessionId);
        return;
      }
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
        ),
      }));
    }
  },

  reconnectAttempt: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false };
    try {
      if (session.type === "serial") {
        if (!session.serialConfig) return { ok: false, errorMessage: "Serial port configuration not found" };
        await serialConnect(session.serialConfig);
        return { ok: true };
      }
      if (session.type !== "ssh") return { ok: false };
      const connection = findConnection(session.connectionId);
      if (!connection) return { ok: false, errorMessage: "Connection config not found" };
      // restore:false — the xterm buffer still holds prior output, so the
      // re-attach redraw repaints the live screen without duplicating scrollback.
      await withSessionConnectLock(sessionId, async () => {
        await sshDisconnect(sessionId).catch(() => {});
        const credentials = await resolveConnectionCredentials(connection);
        const opts = await buildSshConnectOptions(connection, sessionId);
        await sshConnect({
          sessionId,
          host: connection.host,
          port: connection.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          passphrase: credentials.passphrase,
          connectionId: connection.id,
          restore: false,
          attachOnly: !!(session.persist && session.everConnected),
          ...opts,
        });
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
    }
  },

  reconnectWithPassphrase: async (sessionId, passphrase, save) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session || session.type !== "ssh") return;
    const connection = findConnection(session.connectionId);
    if (!connection) return;

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "connecting" as const, errorMessage: undefined } : sess,
      ),
    }));

    try {
      await withSessionConnectLock(sessionId, async () => {
        await sshDisconnect(sessionId).catch(() => {});
        const credentials = await resolveConnectionCredentials(connection);

        if (save) {
          const keyId = connection.key_id ?? (() => {
            if (!connection.identity_id) return undefined;
            const { identities, teamIdentities } = useIdentityStore.getState();
            const allIdentities = [...identities, ...Object.values(teamIdentities).flat()];
            return allIdentities.find((i) => i.id === connection.identity_id)?.key_id;
          })();
          if (keyId) {
            await storeSecret(`key:${keyId}:passphrase`, passphrase);
          } else if (!connection.identity_id) {
            await storeSecret(`passphrase:${connection.id}`, passphrase);
          }
        }

        const opts = await buildSshConnectOptions(connection, sessionId);
        await sshConnect({
          sessionId,
          host: connection.host,
          port: connection.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          passphrase,
          connectionId: connection.id,
          attachOnly: !!(session.persist && session.everConnected),
          ...opts,
        });
      });
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const, everConnected: true } : sess,
        ),
      }));
      reportConnectionAudit(connection, "connection.started");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
        ),
      }));
    }
  },

  retryConnect: async (sessionId, override, save) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session || session.type !== "ssh") return;
    const connection = findConnection(session.connectionId);
    if (!connection) return;

    // Carry overrides across the two-step prompt flow: a username entered first
    // must survive into the subsequent auth prompt.
    const prior = connectOverrides.get(sessionId) ?? {};
    const merged: ConnectRetryOverride = { ...prior };
    for (const [k, v] of Object.entries(override)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
    }
    connectOverrides.set(sessionId, merged);

    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "connecting" as const, errorMessage: undefined } : sess,
      ),
    }));

    try {
      await sshDisconnect(sessionId).catch(() => {});
      const { username, password, privateKey, passphrase } = await resolveOverrideAuth(connection, merged);

      // Still missing something — re-surface the appropriate prompt and keep the
      // accumulated overrides for the next step. Persist the username now if the
      // user asked to save it, so the intent survives into the auth step.
      const preflightError = preflightConnect(username, password, privateKey);
      if (preflightError) {
        if (save && merged.username?.trim()) {
          await persistConnectAuth(connection, { username: merged.username }).catch(() => {});
        }
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: preflightError } : sess,
          ),
        }));
        return;
      }

      if (save) {
        await persistConnectAuth(connection, merged).catch(() => {});
      }

      const opts = await buildSshConnectOptions(connection, sessionId);
      await withSessionConnectLock(sessionId, () =>
        sshConnect({
          sessionId,
          host: connection.host,
          port: connection.port,
          username,
          password,
          privateKey,
          passphrase,
          connectionId: connection.id,
          attachOnly: !!(session.persist && session.everConnected),
          ...opts,
        }),
      );
      connectOverrides.delete(sessionId);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const, everConnected: true } : sess,
        ),
      }));
      useConnectionStore.getState().setLastUsed(connection.id).catch(() => {});
      reportConnectionAudit(connection, "connection.started");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
        ),
      }));
    }
  },

  removeSession: (sessionId) => {
    cancelBackoff(sessionId);
    const state = get();
    const closing = state.sessions.find((s) => s.id === sessionId);
    if (closing) ephemeralConnections.delete(closing.connectionId);
    const remaining = state.sessions.filter((s) => s.id !== sessionId);
    connectOverrides.delete(sessionId);
    set({
      sessions: remaining,
      activeSessionId:
        state.activeSessionId === sessionId
          ? (remaining[remaining.length - 1]?.id ?? null)
      : state.activeSessionId,
    });
    useLayoutStore.getState().removeSession(sessionId);
    useTerminalCwdStore.getState().clear(sessionId);
    usePanelSftpStore.getState().closeSession(sessionId);
  },
}));
