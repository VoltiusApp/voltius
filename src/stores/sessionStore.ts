import { create } from "zustand";
import type { Connection, TerminalSession } from "@/types";
import { sshConnect, sshDisconnect, sshDetectDistro, sshSendInput, type JumpHostConnect } from "@/services/ssh";
import { localConnect, localDisconnect } from "@/services/local";
import { getSecret } from "@/services/vault";
import { useConnectionStore } from "./connectionStore";
import { useUIStore } from "./uiStore";
import { useIdentityStore } from "./identityStore";
import { useTerminalSettingsStore } from "./terminalSettingsStore";

interface SessionStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  connect: (connectionId: string) => Promise<void>;
  connectDirect: (connection: Connection) => Promise<void>;
  connectLocal: () => Promise<void>;
  connectLocalAt: (cwd: string) => Promise<void>;
  connectAt: (connectionId: string, cwd: string) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
  setActive: (sessionId: string) => void;
  markDisconnected: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  reconnect: (sessionId: string) => Promise<void>;
}

async function resolveJumpHosts(connection: Connection): Promise<JumpHostConnect[]> {
  if (!connection.jump_hosts?.length) return [];
  const identities = useIdentityStore.getState().identities;
  return Promise.all(
    connection.jump_hosts.map(async (jh) => {
      if (jh.identity_id) {
        const identity = identities.find((i) => i.id === jh.identity_id);
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
  set: (fn: (s: { sessions: TerminalSession[]; activeSessionId: string | null }) => Partial<SessionStore>) => void,
  connection: Connection,
  sessionId: string,
  password?: string,
  privateKey?: string,
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

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  connect: async (connectionId) => {
    const connection = useConnectionStore
      .getState()
      .connections.find((c) => c.id === connectionId);
    if (!connection) throw new Error("Connection not found");

    const sessionId = crypto.randomUUID();
    let password: string | undefined;
    let privateKey: string | undefined;

    if (connection.identity_id) {
      const identity = useIdentityStore.getState().identities.find((i) => i.id === connection.identity_id);
      if (identity) {
        password = (await getSecret(`identity:${connection.identity_id}:password`)) ?? undefined;
        if (identity.key_id) {
          privateKey = (await getSecret(`key:${identity.key_id}:private`)) ?? undefined;
        }
        const authType = privateKey ? "key" : "password";
        await startSession(set as any, { ...connection, username: identity.username, auth_type: authType }, sessionId, password, privateKey);
        return;
      }
    }

    password = (await getSecret(`password:${connectionId}`)) ?? undefined;
    privateKey = (await getSecret(`key:${connectionId}`)) ?? undefined;

    await startSession(set as any, connection, sessionId, password, privateKey);
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

  disconnect: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (session?.type === "local") {
      await localDisconnect(sessionId);
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
    if (!session || session.type !== "ssh") return;

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
  },
}));
