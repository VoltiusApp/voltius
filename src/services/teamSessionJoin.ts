import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";

export interface JoinTeamSessionParams {
  sessionId: string;
  displayName: string;
  connectionName: string;
  inviteToken?: string;
}

/**
 * Joins a shared multiplayer session, gives it a terminal tab (so
 * MultiplayerBar, keyed off a sessionStore id, has something to key off of),
 * and switches to the terminal nav. Shared by every join-then-open-tab call
 * site: TeamSessions, OmniSearch's team-session and join-code items, and the
 * notification inbox's session-shared action.
 */
export async function joinTeamSessionAndOpenTab(params: JoinTeamSessionParams): Promise<string> {
  const localSessionId = await useTeamSessionStore
    .getState()
    .joinSession(
      params.sessionId,
      params.displayName,
      () => {}, // onControlUpdate — handled by MultiplayerBar
      params.inviteToken,
    );

  useSessionStore.setState((s) => ({
    sessions: [
      ...s.sessions,
      {
        id: localSessionId,
        connectionId: params.sessionId,
        connectionName: params.connectionName,
        status: "connected" as const,
        type: "multiplayer" as const,
      },
    ],
    activeSessionId: localSessionId,
  }));
  useUIStore.getState().setActiveNav("terminal");

  return localSessionId;
}
