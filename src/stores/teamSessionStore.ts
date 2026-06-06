import { create } from "zustand";
import * as mp from "@/services/multiplayerService";
import type { ActiveSession, Participant, MultiplayerConnection } from "@/services/multiplayerService";
import { sshSendInput } from "@/services/ssh";
export type { ActiveSession, Participant };

interface TeamSessionStore {
  activeSessions: ActiveSession[];
  connections: Record<string, MultiplayerSessionState>;

  fetchActiveSessions: () => Promise<void>;

  /**
   * Host: share with members of one or more vaults (E2EE key wrapping).
   * @param allowedRoles - role filter, empty = all roles
   * @param members - members from ALL selected vaults (deduplicated by service)
   */
  startSharing: (
    localSessionId: string,
    vaultIds: string[],
    allowedRoles: string[],
    connectionName: string,
    members: import("@/services/teamService").TeamMember[],
    vaultOwnerTier?: string,
  ) => Promise<string>; // returns multiplayerSessionId

  /**
   * Host: create an invite-link session (raw key, no E2EE).
   * Returns the sessionId and the invite token to share.
   */
  startSharingInviteLink: (
    localSessionId: string,
    connectionName: string,
  ) => Promise<{ multiplayerSessionId: string; inviteToken: string }>;

  // Guest: join a session
  joinSession: (
    multiplayerSessionId: string,
    displayName: string,
    onControlUpdate: (holderId: string, requesterId: string | null) => void,
    inviteToken?: string,
  ) => Promise<string>; // returns localSessionId

  stopSharing: (localSessionId: string) => Promise<void>;
  leaveSession: (localSessionId: string) => void;

  // Control
  requestControl: (localSessionId: string) => void;
  grantControl: (localSessionId: string, targetUserId: string) => void;
  revokeControl: (localSessionId: string) => void;

  getState: (localSessionId: string) => MultiplayerSessionState | undefined;
}

export interface MultiplayerSessionState {
  multiplayerSessionId: string;
  role: "host" | "guest";
  myUserId: string;
  participants: Participant[];
  controlHolder: string;
  controlRequester: string | null;
  connection: MultiplayerConnection;
  ended?: boolean;
  vaultOwnerTier?: string;
  // Runtime-only wiring between the terminal view and store; never persisted.
  _termWrite?: (data: Uint8Array) => void;
  _pendingOutput?: Uint8Array;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCallbacks(localSessionId: string, set: any, _get: any) {
  return {
    onOutput: () => {},
    onInput: (data: Uint8Array) => { sshSendInput(localSessionId, data).catch(() => {}); },
    onControlUpdate: (holderId: string, requesterId: string | null) => {
      set((s: TeamSessionStore) => ({
        connections: { ...s.connections, [localSessionId]: { ...s.connections[localSessionId]!, controlHolder: holderId, controlRequester: requesterId } },
      }));
    },
    onParticipantJoined: (p: Participant) => {
      set((s: TeamSessionStore) => {
        const existing = s.connections[localSessionId];
        if (!existing) return s;
        return { connections: { ...s.connections, [localSessionId]: { ...existing, participants: [...existing.participants.filter((x: Participant) => x.user_id !== p.user_id), p] } } };
      });
    },
    onParticipantLeft: (userId: string) => {
      set((s: TeamSessionStore) => {
        const existing = s.connections[localSessionId];
        if (!existing) return s;
        return { connections: { ...s.connections, [localSessionId]: { ...existing, participants: existing.participants.filter((p: Participant) => p.user_id !== userId) } } };
      });
    },
    onParticipantList: (participants: Participant[]) => {
      set((s: TeamSessionStore) => ({ connections: { ...s.connections, [localSessionId]: { ...s.connections[localSessionId]!, participants } } }));
    },
    onSessionEnded: () => {
      set((s: TeamSessionStore) => {
        const existing = s.connections[localSessionId];
        if (!existing || existing.role === "host") {
          const next = { ...s.connections };
          delete next[localSessionId];
          return { connections: next };
        }
        return { connections: { ...s.connections, [localSessionId]: { ...existing, ended: true } } };
      });
    },
  };
}

export const useTeamSessionStore = create<TeamSessionStore>((set, get) => ({
  activeSessions: [],
  connections: {},

  fetchActiveSessions: async () => {
    const sessions = await mp.listActiveSessions();
    set({ activeSessions: sessions });
  },

  startSharing: async (localSessionId, vaultIds, allowedRoles, connectionName, members, vaultOwnerTier) => {
    const { sessionId, sessionKey } = await mp.createVaultSession(vaultIds, allowedRoles, connectionName, members);

    const serverUrl = await import("@/services/teamService").then((m) => m.getServerUrlValue());
    const jwt = await import("@/services/teamService").then((m) => m.getJwtToken());
    if (!serverUrl || !jwt) throw new Error("Not connected to server");
    const displayName = await import("@/services/account").then((m) => m.getCurrentUserEmail()).then((e) => e ?? "Me");

    const myUserId = await import("@/services/teamService").then((m) => m.getMyUserId()).then((id) => id ?? "");
    const initialSnapshot = mp.drainSshOutputBuffer(localSessionId) ?? undefined;

    const conn = mp.openWebSocket(serverUrl, sessionId, jwt, displayName, sessionKey, {
      ...makeCallbacks(localSessionId, set, get),
      onOutput: () => {},
    }, undefined, initialSnapshot);

    set((s) => ({
      connections: {
        ...s.connections,
        [localSessionId]: { multiplayerSessionId: sessionId, role: "host", myUserId, participants: [], controlHolder: "", controlRequester: null, connection: conn, vaultOwnerTier },
      },
    }));

    get().fetchActiveSessions().catch(() => {});
    return sessionId;
  },

  startSharingInviteLink: async (localSessionId, connectionName) => {
    const { sessionId, sessionKey, inviteToken } = await mp.createInviteLinkSession(connectionName);

    const serverUrl = await import("@/services/teamService").then((m) => m.getServerUrlValue());
    const jwt = await import("@/services/teamService").then((m) => m.getJwtToken());
    if (!serverUrl || !jwt) throw new Error("Not connected to server");
    const displayName = await import("@/services/account").then((m) => m.getCurrentUserEmail()).then((e) => e ?? "Me");

    const myUserId = await import("@/services/teamService").then((m) => m.getMyUserId()).then((id) => id ?? "");
    const initialSnapshot = mp.drainSshOutputBuffer(localSessionId) ?? undefined;

    const conn = mp.openWebSocket(serverUrl, sessionId, jwt, displayName, sessionKey, {
      ...makeCallbacks(localSessionId, set, get),
      onOutput: () => {},
    }, inviteToken, initialSnapshot);

    set((s) => ({
      connections: {
        ...s.connections,
        [localSessionId]: { multiplayerSessionId: sessionId, role: "host", myUserId, participants: [], controlHolder: "", controlRequester: null, connection: conn },
      },
    }));

    get().fetchActiveSessions().catch(() => {});
    return { multiplayerSessionId: sessionId, inviteToken };
  },

  joinSession: async (multiplayerSessionId, displayName, onControlUpdate, inviteToken) => {
    const { sessionKey } = await mp.getMySessionKey(multiplayerSessionId, inviteToken);

    const serverUrl = await import("@/services/teamService").then((m) => m.getServerUrlValue());
    const jwt = await import("@/services/teamService").then((m) => m.getJwtToken());
    if (!serverUrl || !jwt) throw new Error("Not connected to server");

    const localSessionId = crypto.randomUUID();
    const myUserId = await import("@/services/teamService").then((m) => m.getMyUserId()).then((id) => id ?? "");

    const conn = mp.openWebSocket(serverUrl, multiplayerSessionId, jwt, displayName, sessionKey, {
      onOutput: (data) => {
        const conn = get().connections[localSessionId];
        conn?._termWrite?.(data);
      },
      onInput: () => {},
      onControlUpdate: (holderId, requesterId) => {
        onControlUpdate(holderId, requesterId);
        set((s) => ({
          connections: {
            ...s.connections,
            [localSessionId]: { ...s.connections[localSessionId]!, controlHolder: holderId, controlRequester: requesterId },
          },
        }));
      },
      onParticipantJoined: (p) => {
        set((s) => {
          const existing = s.connections[localSessionId];
          if (!existing) return s;
          return { connections: { ...s.connections, [localSessionId]: { ...existing, participants: [...existing.participants.filter((x) => x.user_id !== p.user_id), p] } } };
        });
      },
      onParticipantLeft: (userId) => {
        set((s) => {
          const existing = s.connections[localSessionId];
          if (!existing) return s;
          return { connections: { ...s.connections, [localSessionId]: { ...existing, participants: existing.participants.filter((p) => p.user_id !== userId) } } };
        });
      },
      onParticipantList: (participants) => {
        set((s) => ({ connections: { ...s.connections, [localSessionId]: { ...s.connections[localSessionId]!, participants } } }));
      },
      onSessionEnded: () => {
        set((s) => {
          const existing = s.connections[localSessionId];
          if (!existing) return s;
          return { connections: { ...s.connections, [localSessionId]: { ...existing, ended: true } } };
        });
      },
    }, inviteToken);

    set((s) => ({
      connections: {
        ...s.connections,
        [localSessionId]: { multiplayerSessionId, role: "guest", myUserId, participants: [], controlHolder: "", controlRequester: null, connection: conn },
      },
    }));

    return localSessionId;
  },

  stopSharing: async (localSessionId) => {
    const state = get().connections[localSessionId];
    if (!state) return;
    state.connection.close();
    await mp.endMultiplayerSession(state.multiplayerSessionId).catch(() => {});
    set((s) => {
      const next = { ...s.connections };
      delete next[localSessionId];
      return { connections: next };
    });
    get().fetchActiveSessions().catch(() => {});
  },

  leaveSession: (localSessionId) => {
    const state = get().connections[localSessionId];
    if (state) state.connection.close();
    set((s) => {
      const next = { ...s.connections };
      delete next[localSessionId];
      return { connections: next };
    });
  },

  requestControl: (localSessionId) => {
    get().connections[localSessionId]?.connection.requestControl();
  },

  grantControl: (localSessionId, targetUserId) => {
    get().connections[localSessionId]?.connection.grantControl(targetUserId);
  },

  revokeControl: (localSessionId) => {
    get().connections[localSessionId]?.connection.revokeControl();
  },

  getState: (localSessionId) => get().connections[localSessionId],
}));
