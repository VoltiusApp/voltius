import { create } from "zustand";
import type { Connection, TerminalSession, SerialConnectParams } from "@/types";
import { sshConnect, sshDisconnect, sshDetectDistro, sshSendInput, type JumpHostConnect } from "@/services/ssh";
import { localConnect, localDisconnect } from "@/services/local";
import { serialConnect, serialDisconnect } from "@/services/serial";
import { getSecret } from "@/services/vault";
import { useConnectionStore } from "./connectionStore";
import { useUIStore } from "./uiStore";
import { useIdentityStore } from "./identityStore";
import { useTerminalSettingsStore } from "./terminalSettingsStore";
import { useLayoutStore } from "./layoutStore";

interface SessionStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  connect: (connectionId: string) => Promise<void>;
  connectMany: (connectionIds: string[]) => Promise<string[]>;
  connectDirect: (connection: Connection) => Promise<void>;
  connectLocal: () => Promise<void>;
  connectLocalAt: (cwd: string) => Promise<void>;
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
}

type SessionSetter = (fn: (s: { sessions: TerminalSession[]; activeSessionId: string | null }) => Partial<SessionStore>) => void;

function findConnection(connectionId: string): Connection | undefined {
  const { connections, teamConnections } = useConnectionStore.getState();
  return (
    connections.find((c) => c.id === connectionId) ??
    Object.values(teamConnections).flat().find((c) => c.id === connectionId)
  );
}

async function resolveJumpHosts(connection: Connection): Promise<JumpHostConnect[]> {
  if (!connection.jump_hosts?.length) return [];
  const { identities, teamIdentities } = useIdentityStore.getState();
  const allIdentities = [...identities, ...Object.values(teamIdentities).flat()];
  return Promise.all(
    connection.jump_hosts.map(async (jh) => {
      if (jh.identity_id) {
        const identity = allIdentities.find((i) => i.id === jh.identity_id);
        if (identity) {
          const pwd = (await getSecret(`identity:${jh.identity_id}:password`).catch(() => null)) ?? undefined;
          const pk = identity.key_id
            ? (await getSecret(`key:${identity.key_id}:private`).catch(() => null)) ?? undefined
            : undefined;
          return { host: jh.host, port: jh.port, username: identity.username, password: pwd, privateKey: pk };
        }
      }
      // Use the referenced connection's own stored credentials
      const pwd = (await getSecret(`password:${jh.connection_id}`).catch(() => null)) ?? undefined;
      const pk = (await getSecret(`key:${jh.connection_id}`).catch(() => null)) ?? undefined;
      return { host: jh.host, port: jh.port, username: jh.username, password: pwd, privateKey: pk };
    })
  );
}

async function startSession(
  set: SessionSetter,
  connection: Connection,
  sessionId: string,
  password?: string,
  privateKey?: string,
) {
  createSshSession(set, connection, sessionId);
  await connectSshSession(set, connection, sessionId, password, privateKey);
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
      connectionId: connection.id,
      jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
      envVars: envVars.length > 0 ? envVars : undefined,
      agentForwarding: connection.agent_forwarding ?? false,
      preCommand,
    });
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status: "connected" as const } : sess,
      ),
    }));

    useConnectionStore.getState().setLastUsed(connection.id).catch(() => {});

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

async function resolveConnectionCredentials(connection: Connection): Promise<{
  connection: Connection;
  password?: string;
  privateKey?: string;
}> {
  if (connection.identity_id) {
    const { identities, teamIdentities } = useIdentityStore.getState();
    const identity =
      identities.find((i) => i.id === connection.identity_id) ??
      Object.values(teamIdentities).flat().find((i) => i.id === connection.identity_id);
    if (identity) {
      const password = (await getSecret(`identity:${connection.identity_id}:password`)) ?? undefined;
      const privateKey = identity.key_id
        ? (await getSecret(`key:${identity.key_id}:private`)) ?? undefined
        : undefined;
      return {
        connection: { ...connection, username: identity.username, auth_type: privateKey ? "key" : "password" },
        password,
        privateKey,
      };
    }
  }

  return {
    connection,
    password: (await getSecret(`password:${connection.id}`)) ?? undefined,
    privateKey: (await getSecret(`key:${connection.id}`)) ?? undefined,
  };
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
    .then((resolved) => connectSshSession(set, resolved.connection, sessionId, resolved.password, resolved.privateKey))
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

  let password: string | undefined;
  let privateKey: string | undefined;
  let sessionConnection = connection;

  if (connection.identity_id) {
    const { identities, teamIdentities } = useIdentityStore.getState();
    const identity =
      identities.find((i) => i.id === connection.identity_id) ??
      Object.values(teamIdentities).flat().find((i) => i.id === connection.identity_id);
    if (identity) {
      password = (await getSecret(`identity:${connection.identity_id}:password`)) ?? undefined;
      if (identity.key_id) {
        privateKey = (await getSecret(`key:${identity.key_id}:private`)) ?? undefined;
      }
      sessionConnection = { ...connection, username: identity.username, auth_type: privateKey ? "key" : "password" };
    }
  } else {
    password = (await getSecret(`password:${connectionId}`)) ?? undefined;
    privateKey = (await getSecret(`key:${connectionId}`)) ?? undefined;
  }

  try {
    await startSession(set, sessionConnection, sessionId, password, privateKey);
  } catch (err) {
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
    const session: TerminalSession = {
      id: sessionId,
      connectionId: "local",
      connectionName: "Local Shell",
      status: "connecting",
      type: "local",
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    useLayoutStore.getState().setSplitTabActive(false);
    try {
      const preferredShell = useTerminalSettingsStore.getState().preferredShell;
      await localConnect(sessionId, 80, 24, preferredShell ?? undefined);
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
    const session: TerminalSession = {
      id: sessionId,
      connectionId: "local",
      connectionName: "Local Shell",
      status: "connecting",
      type: "local",
    };
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: sessionId }));
    useLayoutStore.getState().setSplitTabActive(false);
    try {
      const preferredShell = useTerminalSettingsStore.getState().preferredShell;
      await localConnect(sessionId, 80, 24, preferredShell ?? undefined, cwd);
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
      const connection = session?.connectionId
        ? useConnectionStore.getState().connections.find((c) => c.id === session.connectionId)
        : undefined;
      await sshDisconnect(sessionId, connection?.post_command);
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

    const connection = useConnectionStore.getState().connections.find((c) => c.id === session.connectionId);
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
      let password: string | undefined;
      let privateKey: string | undefined;
      let username = connection.username;

      if (connection.identity_id) {
        const identity = useIdentityStore.getState().identities.find((i) => i.id === connection.identity_id);
        if (identity) {
          username = identity.username;
          password = (await getSecret(`identity:${connection.identity_id}:password`)) ?? undefined;
          if (identity.key_id) {
            privateKey = (await getSecret(`key:${identity.key_id}:private`)) ?? undefined;
          }
        }
      } else {
        password = (await getSecret(`password:${connection.id}`)) ?? undefined;
        privateKey = (await getSecret(`key:${connection.id}`)) ?? undefined;
      }

      await sshConnect({ sessionId, host: connection.host, port: connection.port, username, password, privateKey, connectionId: connection.id });
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
  },
}));
