import { create } from "zustand";
import type { Connection, TerminalSession, SerialConnectParams } from "@/types";
import { sshConnect, sshDisconnect, sshDetectDistro, sshSendInput } from "@/services/ssh";
import { localConnect, localDisconnect } from "@/services/local";
import { serialConnect, serialDisconnect } from "@/services/serial";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { storeSecret } from "@/services/vault";
import { useIdentityStore } from "@/stores/identityStore";
import { auditContextForVaultId } from "@/services/auditContextResolver";
import { reportAuditClientEvent, type ClientAuditAction } from "@/services/auditReporter";
import { useConnectionStore } from "./connectionStore";
import { useUIStore } from "./uiStore";
import { useTerminalSettingsStore } from "./terminalSettingsStore";
import { usePortForwardingSettingsStore } from "./portForwardingSettingsStore";
import { useLayoutStore } from "./layoutStore";
import { useTerminalCwdStore } from "./terminalCwdStore";
import { usePanelSftpStore } from "./panelSftpStore";
import { formatLocalShellTitle } from "@/utils/localShellTitle";

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
  connectSerialEphemeral: () => Promise<void>;
  connectSerialEphemeralFinalize: (sessionId: string, params: SerialConnectParams) => Promise<void>;
  resetSerialEphemeral: (sessionId: string) => void;
  disconnect: (sessionId: string) => Promise<void>;
  setActive: (sessionId: string) => void;
  markDisconnected: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  reconnect: (sessionId: string) => Promise<void>;
  reconnectWithPassphrase: (sessionId: string, passphrase: string, save: boolean) => Promise<void>;
}

type SessionSetter = (fn: (s: { sessions: TerminalSession[]; activeSessionId: string | null }) => Partial<SessionStore>) => void;

function findConnection(connectionId: string): Connection | undefined {
  const { connections, teamConnections } = useConnectionStore.getState();
  return (
    connections.find((c) => c.id === connectionId) ??
    Object.values(teamConnections).flat().find((c) => c.id === connectionId)
  );
}

function reportConnectionAudit(connection: Connection, action: ClientAuditAction): void {
  reportAuditClientEvent(auditContextForVaultId(connection.vault_id), action, {
    target_type: "connection",
    target_id: connection.id,
    target_name: connection.name?.trim() || `${connection.username}@${connection.host}:${connection.port}`,
  });
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
    type: "ssh",
    encoding: connection.terminal_encoding,
  };

  set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
  useLayoutStore.getState().setSplitTabActive(false);
}

async function connectSshSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
  password?: string,
  privateKey?: string,
  passphrase?: string,
) {
  const jumpHosts = await resolveJumpHosts(connection);

  const envVars = connection.env_vars?.map((e): [string, string] => [e.key, e.value]) ?? [];
  const preCommand = connection.pre_command ?? undefined;

  try {
    await sshConnect({
      sessionId,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password,
      privateKey,
      passphrase,
      connectionId: connection.id,
      jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
      envVars: envVars.length > 0 ? envVars : undefined,
      agentForwarding: connection.agent_forwarding ?? false,
      preCommand,
      autoForward: usePortForwardingSettingsStore.getState().autoForwardEnabled,
      shellIntegration: useTerminalSettingsStore.getState().shellIntegrationEnabled,
    });
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
      ),
    }));

    useConnectionStore.getState().setLastUsed(connection.id).catch(() => {});
    reportConnectionAudit(connection, "connection.started");

    // Detect distro only if not already known
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
    await startSession(set as any, connection, sessionId);
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
      await localConnect(sessionId, 80, 24, preferredShell ?? undefined, undefined, useTerminalSettingsStore.getState().shellIntegrationEnabled);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }));
      useUIStore.getState().setActiveNav("terminal" as any);
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
      await localConnect(sessionId, 80, 24, preferredShell ?? undefined, cwd, useTerminalSettingsStore.getState().shellIntegrationEnabled);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }));
      useUIStore.getState().setActiveNav("terminal" as any);
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
    void localConnect(sessionId, 80, 24, shell, undefined, useTerminalSettingsStore.getState().shellIntegrationEnabled).then(() => {
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
    useUIStore.getState().setActiveNav("terminal" as any);
    useUIStore.getState().setSidebarOpen(false);
  },

  connectSerial: async (connectionId) => {
    const connection = findConnection(connectionId);
    if (!connection) throw new Error("Connection not found");

    const sessionId = crypto.randomUUID();
    await startSerialSession(set as SessionSetter, connection, sessionId);
    useUIStore.getState().setActiveNav("terminal" as any);
    useUIStore.getState().setSidebarOpen(false);
  },

  connectSerialEphemeral: async () => {
    const sessionId = crypto.randomUUID();
    const session: TerminalSession = {
      id: sessionId,
      connectionId: "serial-ephemeral",
      connectionName: "Serial",
      status: "connecting",
      type: "serial",
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    useLayoutStore.getState().setSplitTabActive(false);
    useUIStore.getState().setActiveNav("terminal" as any);
    useUIStore.getState().setSidebarOpen(false);
  },

  connectSerialEphemeralFinalize: async (sessionId, params) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, serialConfig: params, status: "connecting" as const, errorMessage: undefined }
          : sess,
      ),
    }) as any);
    try {
      await serialConnect(params);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }) as any);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "error" as const, errorMessage: msg } : sess,
        ),
      }) as any);
    }
  },

  resetSerialEphemeral: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, serialConfig: undefined, status: "connecting" as const, errorMessage: undefined }
          : sess,
      ),
    }) as any);
  },

  disconnect: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (session?.type === "local") {
      await localDisconnect(sessionId);
    } else if (session?.type === "serial") {
      await serialDisconnect(sessionId).catch(() => {});
    } else {
      const connection = session?.connectionId ? findConnection(session.connectionId) : undefined;
      await sshDisconnect(sessionId, connection?.post_command);
      if (connection) reportConnectionAudit(connection, "connection.ended");
    }
    const state = get();
    const remaining = state.sessions.filter((s) => s.id !== sessionId);
    set({
      sessions: remaining,
      activeSessionId:
        state.activeSessionId === sessionId
          ? (remaining[remaining.length - 1]?.id ?? null)
      : state.activeSessionId,
    } as any);
    useLayoutStore.getState().removeSession(sessionId);
    useTerminalCwdStore.getState().clear(sessionId);
    usePanelSftpStore.getState().closeSession(sessionId);
  },

  setActive: (sessionId) => set({ activeSessionId: sessionId } as any),

  markDisconnected: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "disconnected" as const } : sess,
      ),
    }) as any),

  reconnect: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session || (session.type !== "ssh" && session.type !== "serial")) return;

    // Handle serial reconnect
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
    if (session.type === "serial") return; // no config, can't reconnect

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
      const credentials = await resolveConnectionCredentials(connection);

      await sshConnect({ sessionId, host: connection.host, port: connection.port, username: credentials.username, password: credentials.password, privateKey: credentials.privateKey, passphrase: credentials.passphrase, connectionId: connection.id, autoForward: usePortForwardingSettingsStore.getState().autoForwardEnabled, shellIntegration: useTerminalSettingsStore.getState().shellIntegrationEnabled });
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
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
      const credentials = await resolveConnectionCredentials(connection);

      if (save) {
        const keyId = connection.key_id ?? (() => {
          if (!connection.identity_id) return undefined;
          const { identities, teamIdentities } = useIdentityStore.getState();
          const allIdentities = [...identities, ...Object.values(teamIdentities).flat()];
          return allIdentities.find((i) => i.id === connection.identity_id)?.key_id;
        })();
        if (keyId) await storeSecret(`key:${keyId}:passphrase`, passphrase);
      }

      const jumpHosts = await resolveJumpHosts(connection);
      await sshConnect({
        sessionId,
        host: connection.host,
        port: connection.port,
        username: credentials.username,
        password: credentials.password,
        privateKey: credentials.privateKey,
        passphrase,
        connectionId: connection.id,
        jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
        autoForward: usePortForwardingSettingsStore.getState().autoForwardEnabled,
        shellIntegration: useTerminalSettingsStore.getState().shellIntegrationEnabled,
      });
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
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

  removeSession: (sessionId) => {
    const state = get();
    const remaining = state.sessions.filter((s) => s.id !== sessionId);
    set({
      sessions: remaining,
      activeSessionId:
        state.activeSessionId === sessionId
          ? (remaining[remaining.length - 1]?.id ?? null)
      : state.activeSessionId,
    } as any);
    useLayoutStore.getState().removeSession(sessionId);
    useTerminalCwdStore.getState().clear(sessionId);
    usePanelSftpStore.getState().closeSession(sessionId);
  },
}));
