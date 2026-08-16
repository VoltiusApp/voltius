import { create, type StoreApi } from "zustand";
import i18n from "@/i18n";
import * as mp from "@/services/multiplayerService";
import type { ActiveSession, Participant, MultiplayerConnection, SessionKey } from "@/services/multiplayerService";
import { sendSessionInput } from "@/services/sessionInput";
import { getSessionTransportType } from "@/stores/sessionStore";
import type { TeamMember } from "@/services/teamService";
import type { InviteTarget } from "@/services/teamSharing";
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
    members: TeamMember[],
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

  /**
   * Host: create a direct session (no vault scope, E2EE per-invitee key wrapping) (#66).
   * Invitees are `InviteTarget`, not `TeamMember`: any Voltius user can be invited
   * directly, not only a teammate (#unified-invite).
   */
  startSharingDirect: (
    localSessionId: string,
    connectionName: string,
    invitees: InviteTarget[],
  ) => Promise<string>; // returns multiplayerSessionId

  /** Host: grant an already-live session to anyone — teammate or stranger — by wrapping the retained session key for them (#66, #unified-invite). */
  inviteToActiveSession: (localSessionId: string, target: InviteTarget) => Promise<void>;

  joinSession: (
    multiplayerSessionId: string,
    onControlUpdate: (holderId: string, requesterId: string | null) => void,
    inviteToken?: string,
  ) => Promise<string>; // returns localSessionId

  stopSharing: (localSessionId: string) => Promise<void>;
  leaveSession: (localSessionId: string) => void;

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
  // Raw session key bytes, retained so a live E2EE session can invite more members later (#66).
  sessionKeyBytes?: Uint8Array;
  // Runtime-only wiring between the terminal view and store; never persisted.
  _termWrite?: (data: Uint8Array) => void;
  _pendingOutput?: Uint8Array;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCallbacks(localSessionId: string, set: any, _get: any) {
  return {
    onOutput: () => {},
    // A guest with control types into whatever the host is running — a local
    // shell and a serial port as much as an SSH channel.
    onInput: (data: Uint8Array) => {
      sendSessionInput(localSessionId, getSessionTransportType(localSessionId), data).catch(() => {});
    },
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

type SetState = StoreApi<TeamSessionStore>["setState"];
type GetState = StoreApi<TeamSessionStore>["getState"];

/**
 * Shared tail for every host-side share-start path: resolve server/JWT/identity,
 * carry over pre-share scrollback, open the websocket, and record the connection (#66).
 */
async function attachAsHost(
  localSessionId: string,
  sessionId: string,
  sessionKey: SessionKey,
  set: SetState,
  get: GetState,
  extra: { inviteToken?: string; vaultOwnerTier?: string; sessionKeyBytes?: Uint8Array },
): Promise<void> {
  const serverUrl = await import("@/services/teamService").then((m) => m.getServerUrlValue());
  const jwt = await import("@/services/teamService").then((m) => m.getJwtToken());
  if (!serverUrl || !jwt) throw new Error(i18n.t("common.error.notConnectedToServer"));

  const myUserId = await import("@/services/teamService").then((m) => m.getMyUserId()).then((id) => id ?? "");
  const initialSnapshot = mp.drainSessionOutputBuffer(localSessionId) ?? undefined;

  const conn = mp.openWebSocket(serverUrl, sessionId, jwt, sessionKey, {
    ...makeCallbacks(localSessionId, set, get),
    onOutput: () => {},
  }, extra.inviteToken, initialSnapshot);

  set((s) => ({
    connections: {
      ...s.connections,
      [localSessionId]: {
        multiplayerSessionId: sessionId, role: "host", myUserId, participants: [], controlHolder: "", controlRequester: null,
        connection: conn, vaultOwnerTier: extra.vaultOwnerTier, sessionKeyBytes: extra.sessionKeyBytes,
      },
    },
  }));

  get().fetchActiveSessions().catch(() => {});
}

export const useTeamSessionStore = create<TeamSessionStore>((set, get) => ({
  activeSessions: [],
  connections: {},

  fetchActiveSessions: async () => {
    const sessions = await mp.listActiveSessions();
    set({ activeSessions: sessions });
  },

  startSharing: async (localSessionId, vaultIds, allowedRoles, connectionName, members, vaultOwnerTier) => {
    const { sessionId, sessionKey, sessionKeyBytes } = await mp.createVaultSession(vaultIds, allowedRoles, connectionName, members);
    await attachAsHost(localSessionId, sessionId, sessionKey, set, get, { vaultOwnerTier, sessionKeyBytes });
    return sessionId;
  },

  startSharingInviteLink: async (localSessionId, connectionName) => {
    const { sessionId, sessionKey, inviteToken } = await mp.createInviteLinkSession(connectionName);
    await attachAsHost(localSessionId, sessionId, sessionKey, set, get, { inviteToken });
    return { multiplayerSessionId: sessionId, inviteToken };
  },

  startSharingDirect: async (localSessionId, connectionName, invitees) => {
    const { sessionId, sessionKey, sessionKeyBytes } = await mp.createDirectSession(connectionName, invitees);
    await attachAsHost(localSessionId, sessionId, sessionKey, set, get, { sessionKeyBytes });
    return sessionId;
  },

  inviteToActiveSession: async (localSessionId, target) => {
    const state = get().connections[localSessionId];
    if (!state?.sessionKeyBytes) throw new Error(i18n.t("common.error.cannotInviteWithoutSessionKey"));
    await mp.inviteUserToSession(state.multiplayerSessionId, target, state.sessionKeyBytes);
    get().fetchActiveSessions().catch(() => {});
  },

  joinSession: async (multiplayerSessionId, onControlUpdate, inviteToken) => {
    const { sessionKey } = await mp.getMySessionKey(multiplayerSessionId, inviteToken);

    const serverUrl = await import("@/services/teamService").then((m) => m.getServerUrlValue());
    const jwt = await import("@/services/teamService").then((m) => m.getJwtToken());
    if (!serverUrl || !jwt) throw new Error(i18n.t("common.error.notConnectedToServer"));

    const localSessionId = crypto.randomUUID();
    const myUserId = await import("@/services/teamService").then((m) => m.getMyUserId()).then((id) => id ?? "");

    const conn = mp.openWebSocket(serverUrl, multiplayerSessionId, jwt, sessionKey, {
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
