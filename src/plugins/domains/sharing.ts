import type { ActiveSession, Participant } from "@/services/multiplayerService";
import type { MultiplayerSessionState } from "@/stores/teamSessionStore";
import type { TeamMember } from "@/services/teamService";
import { failed, type DomainResult } from "./result";

/**
 * The terminal-sharing operations this domain needs, as plain functions.
 * `startSharingInviteLink` (the invite-link path in the store) is deliberately
 * not exposed here: MCP sharing is scoped to named team members only.
 */
export interface SharingPorts {
  activeSessions(): ActiveSession[];
  fetchActiveSessions(): Promise<void>;
  state(localSessionId: string): MultiplayerSessionState | undefined;
  localSessions(): string[];
  startSharing(
    localSessionId: string, vaultIds: string[], allowedRoles: string[],
    connectionName: string, members: TeamMember[], vaultOwnerTier?: string,
  ): Promise<string>;
  stopSharing(localSessionId: string): Promise<void>;
  grantControl(localSessionId: string, targetUserId: string): void;
  /** True when typed input in this session's tab is fanned out to every pane. */
  broadcastActiveForSession(localSessionId: string): boolean;
  connectionName(localSessionId: string): string | undefined;
  teamMembers(teamIds: string[]): Promise<TeamMember[]>;
  ownerTier(teamIds: string[]): string;
  /**
   * The signed-in user, from the account — NOT from a live multiplayer
   * connection. `isHost` must stay correct for a session hosted from another
   * device or a previous run of the app, when no connection is open here.
   */
  myUserId(): Promise<string | null>;
}

export interface PluginSharedSession {
  multiplayerSessionId: string;
  localSessionId: string | null;
  connectionName: string;
  isHost: boolean;
  participants: { userId: string; displayName: string }[];
  controlHolder: string;
  controlRequester: string | null;
}

const BROADCAST_REFUSAL =
  "that tab has broadcast typing enabled; your own keystrokes would reach every participant — turn broadcast off before sharing";

/**
 * Why `share_session` must refuse this session, or null when it may proceed.
 *
 * Split out of `shareSession` so the tool layer can make the same call before
 * it raises an approval card or writes an audit row: a share refused for
 * broadcast must leave neither behind. The predicate itself still lives once,
 * in layoutStore, behind `broadcastActiveForSession`.
 */
export function shareRefusalReason(ports: SharingPorts, sessionId: string): string | null {
  // routeInputBytes (useTerminal.ts) fans typed input to every session in an
  // active broadcast split tab. Sharing one would send the user's own
  // keystrokes to remote participants.
  return ports.broadcastActiveForSession(sessionId) ? BROADCAST_REFUSAL : null;
}

export async function listSharedSessions(ports: SharingPorts): Promise<PluginSharedSession[]> {
  await ports.fetchActiveSessions();
  const localByMultiplayer = new Map(
    ports.localSessions()
      .map((localId) => [ports.state(localId)?.multiplayerSessionId, localId] as const)
      .filter((pair): pair is readonly [string, string] => Boolean(pair[0])),
  );
  const me = await ports.myUserId();
  return ports.activeSessions().map((s: ActiveSession) => {
    const localId = localByMultiplayer.get(s.id) ?? null;
    const live = localId ? ports.state(localId) : undefined;
    return {
      multiplayerSessionId: s.id,
      localSessionId: localId,
      connectionName: s.connection_name,
      isHost: s.host_user_id === me,
      participants: (live?.participants ?? s.participants ?? []).map((p: Participant) => ({
        userId: p.user_id,
        displayName: p.display_name,
      })),
      controlHolder: live?.controlHolder ?? s.host_user_id,
      controlRequester: live?.controlRequester ?? null,
    };
  });
}

export async function shareSession(
  ports: SharingPorts,
  input: { sessionId: string; vaultIds: string[]; allowedRoles?: string[] },
): Promise<DomainResult<{ multiplayerSessionId: string }>> {
  if (ports.state(input.sessionId)) return { ok: false, error: "that session is already shared" };
  if (input.vaultIds.length === 0) return { ok: false, error: "name at least one team vault to share with" };
  // Defence in depth: the tool layer refuses this before the gate, but a caller
  // reaching the domain directly (a plugin, a test) gets the same refusal, and
  // broadcast can be switched on while an approval card sits pending.
  const blocked = shareRefusalReason(ports, input.sessionId);
  if (blocked) return { ok: false, error: blocked };
  try {
    const members = await ports.teamMembers(input.vaultIds);
    const id = await ports.startSharing(
      input.sessionId, input.vaultIds, input.allowedRoles ?? [],
      ports.connectionName(input.sessionId) ?? input.sessionId,
      members, ports.ownerTier(input.vaultIds),
    );
    return { ok: true, result: { multiplayerSessionId: id } };
  } catch (err) {
    return failed(err);
  }
}

export async function unshareSession(ports: SharingPorts, sessionId: string): Promise<DomainResult<null>> {
  const live = ports.state(sessionId);
  if (!live) return { ok: false, error: "that session is not shared" };
  if (live.role !== "host") return { ok: false, error: "only the host can stop sharing that session" };
  try {
    await ports.stopSharing(sessionId);
    return { ok: true, result: null };
  } catch (err) {
    return failed(err);
  }
}

/**
 * Approve a pending control request. Deliberately not a general grant: the
 * server lets a host hand control to any participant, but a human who has not
 * asked for it in that moment has not consented to holding a live shell.
 */
export async function handoffControl(
  ports: SharingPorts, sessionId: string, userId: string,
): Promise<DomainResult<null>> {
  const live = ports.state(sessionId);
  if (!live) return { ok: false, error: "that session is not shared" };
  if (live.role !== "host") return { ok: false, error: "only the host can hand off control" };
  if (live.controlRequester !== userId) {
    const who = live.controlRequester ? `${live.controlRequester} is currently asking` : "nobody is currently asking";
    return {
      ok: false,
      error: `${userId} has not requested control; control is only handed to a participant who asked for it (${who})`,
    };
  }
  ports.grantControl(sessionId, userId);
  return { ok: true, result: null };
}
