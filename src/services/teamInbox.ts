import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import type { InboxEntry, InboxKind } from "@/stores/notificationStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import type { MultiplayerSessionState } from "@/stores/teamSessionStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import type { TeamVaultStatus } from "@/stores/teamVaultStateStore";
import { acceptInvitation, declineInvitation } from "@/services/invitationActions";
import { getCurrentUserEmail } from "@/services/account";
import { joinTeamSessionAndOpenTab } from "@/services/teamSessionJoin";
import { getPlatform, isMobileShell } from "@/utils/platform";
import { getMyUserId } from "@/services/teamService";
import type { MyPendingInvitation } from "@/services/teamService";
import type { ActiveSession } from "@/services/multiplayerService";

const APP_SOURCE = { kind: "app", area: "team" } as const;

// Deny has no server-side state to delete: the connection still reports the
// requester, so without this the next reconcile re-derives the entry and
// re-toasts it. An id leaves the set once the source stops carrying that
// request, so a fresh request from the same guest knocks again.
const deniedRequests = new Set<string>();
// Sessions whose "you have control" toast already fired, so it posts once per
// grant instead of on every reconcile.
const controlHeldSessions = new Set<string>();

/** Clears the per-reconcile memory that has no source of truth to re-derive from. */
export function resetTeamInboxState(): void {
  deniedRequests.clear();
  controlHeldSessions.clear();
}

function toast(message: string, duration: number): void {
  useNotificationStore.getState().addToast({
    source: APP_SOURCE,
    type: "toast",
    message,
    severity: "info",
    duration,
  });
}

/**
 * Upserts the given entries and retracts any existing entry of the same kinds that is
 * no longer present. Every reconciler below is one call to this.
 */
function reconcile(
  kinds: InboxKind[],
  entries: Array<
    Omit<InboxEntry, "createdAt" | "source" | "state"> & { state?: InboxEntry["state"]; resolution?: string }
  >,
): void {
  const store = useNotificationStore.getState();
  const wanted = new Set(entries.map((e) => e.id));
  for (const existing of store.inbox) {
    if (kinds.includes(existing.kind) && !wanted.has(existing.id)) {
      store.retractInbox(existing.id);
    }
  }
  for (const entry of entries) {
    store.upsertInbox({ ...entry, source: APP_SOURCE });
  }
}

export function reconcileInvites(invites: MyPendingInvitation[]): void {
  reconcile(
    ["invite"],
    invites.map((inv) => ({
      id: `invite:${inv.id}`,
      kind: "invite" as const,
      message: i18n.t("notifications.inbox.invite.message", {
        inviter: inv.inviter_display_name ?? i18n.t("notifications.inbox.someone"),
        team: inv.team_name,
      }),
      actions: [
        { label: i18n.t("notifications.inbox.invite.accept"), run: () => acceptInvitation(inv.id, inv.team_id) },
        { label: i18n.t("notifications.inbox.invite.decline"), run: () => declineInvitation(inv.id) },
      ],
    })),
  );
}

async function joinSharedSession(session: ActiveSession): Promise<void> {
  const displayName = (await getCurrentUserEmail()) ?? i18n.t("hosts.teamSessions.meFallback");
  await joinTeamSessionAndOpenTab({
    sessionId: session.id,
    displayName,
    connectionName: session.connection_name,
  });
}

export function reconcileSessions(
  sessions: ActiveSession[],
  joinedSessionIds: Set<string>,
  myUserId: string | null,
): void {
  reconcile(
    ["sessionShared"],
    // A session I host is not a knock — I am the one who shared it. The rail
    // deliberately keeps my own sessions so I don't lose track of them; the
    // inbox must not tell me a teammate shared my own terminal.
    sessions
      .filter((s) => s.host_user_id !== myUserId)
      .map((s) => {
        const joined = joinedSessionIds.has(s.id);
        return {
          id: `session:${s.id}`,
          kind: "sessionShared" as const,
          message: i18n.t("notifications.inbox.session.message", { name: s.connection_name }),
          // Spelled out rather than left undefined: upsertInbox keeps the
          // previous state when it is omitted, which pinned an entry as
          // "resolved" — hiding its Join button — after a guest left and the
          // session became joinable again.
          state: joined ? ("resolved" as const) : ("pending" as const),
          resolution: joined ? i18n.t("notifications.inbox.session.joined") : undefined,
          // The knock is worth having everywhere, but Join is not offered on
          // mobile: MobileSessionLayer and MobileTerminalScreen both filter out
          // `multiplayer` sessions, so joining there opens a websocket and then
          // lands on "No active sessions". Re-enable once mobile renders them.
          actions:
            joined || isMobileShell()
              ? []
              : [{ label: i18n.t("notifications.inbox.session.join"), run: () => joinSharedSession(s) }],
        };
      }),
  );
}

export function reconcileControlRequests(connections: Record<string, MultiplayerSessionState>): void {
  const derived = Object.entries(connections)
    .filter(
      ([, c]) => !c.ended && c.role === "host" && c.controlRequester !== null && c.controlRequester !== c.myUserId,
    )
    .map(([localSessionId, c]) => {
      const requesterId = c.controlRequester as string;
      const id = `control:${localSessionId}:${requesterId}`;
      const requester =
        c.participants.find((p) => p.user_id === requesterId)?.display_name ??
        i18n.t("notifications.inbox.someone");
      return {
        id,
        kind: "controlRequest" as const,
        message: i18n.t("notifications.inbox.control.request", { requester }),
        actions: [
          {
            label: i18n.t("notifications.inbox.control.grant"),
            run: async () => useTeamSessionStore.getState().grantControl(localSessionId, requesterId),
          },
          {
            label: i18n.t("notifications.inbox.control.deny"),
            run: async () => {
              deniedRequests.add(id);
              useNotificationStore.getState().retractInbox(id);
            },
          },
        ],
      };
    });

  const derivedIds = new Set(derived.map((e) => e.id));
  for (const id of deniedRequests) {
    if (!derivedIds.has(id)) deniedRequests.delete(id);
  }
  const entries = derived.filter((e) => !deniedRequests.has(e.id));

  // Toast only for requests not already in the inbox, so repeated reconciles stay silent.
  const known = new Set(
    useNotificationStore.getState().inbox.filter((e) => e.kind === "controlRequest").map((e) => e.id),
  );
  for (const e of entries) {
    if (!known.has(e.id)) toast(e.message, 8000);
  }

  reconcile(["controlRequest"], entries);

  // Spec C4: the guest gets a brief confirmation the moment control lands on
  // them. Derived from the same connection state, deduped like the request
  // toast so it fires once per grant.
  for (const id of controlHeldSessions) {
    if (!(id in connections)) controlHeldSessions.delete(id);
  }
  for (const [localSessionId, c] of Object.entries(connections)) {
    const holdsControl = !c.ended && c.role !== "host" && c.controlHolder === c.myUserId;
    if (!holdsControl) {
      controlHeldSessions.delete(localSessionId);
    } else if (!controlHeldSessions.has(localSessionId)) {
      controlHeldSessions.add(localSessionId);
      toast(i18n.t("notifications.inbox.control.granted"), 4000);
    }
  }
}

export function reconcileAwaitingKeys(statusByTeamId: Record<string, TeamVaultStatus>): void {
  const teams = useTeamStore.getState().teams;
  reconcile(
    ["awaitingKey"],
    Object.entries(statusByTeamId)
      .filter(([, status]) => status === "awaiting_key")
      .map(([teamId]) => ({
        id: `awaiting-key:${teamId}`,
        kind: "awaitingKey" as const,
        message: i18n.t("notifications.inbox.awaitingKey.message", {
          team: teams.find((t) => t.id === teamId)?.name ?? teamId,
        }),
        actions: [],
      })),
  );
}

export function startTeamInbox(): () => void {
  resetTeamInboxState();
  reconcileInvites(useTeamStore.getState().myPendingInvitations);
  const unsubInvites = useTeamStore.subscribe((s, prev) => {
    if (s.myPendingInvitations !== prev.myPendingInvitations) {
      reconcileInvites(s.myPendingInvitations);
    }
  });

  let stopped = false;
  let myUserId: string | null = null;
  const syncSessions = (st: ReturnType<typeof useTeamSessionStore.getState>) => {
    const joined = new Set(Object.values(st.connections).map((c) => c.multiplayerSessionId));
    reconcileSessions(st.activeSessions, joined, myUserId);
    reconcileControlRequests(st.connections);
  };
  syncSessions(useTeamSessionStore.getState());
  // Both are async, so the first pass above runs with a null user id (cannot
  // filter my own sessions) and an unprimed platform (isMobileShell is false).
  // Re-run once they land, to retract what slipped through and to drop a Join
  // action that mobile cannot honour.
  Promise.all([getMyUserId(), getPlatform()])
    .then(([id]) => {
      if (stopped) return;
      myUserId = id;
      syncSessions(useTeamSessionStore.getState());
    })
    .catch(() => {});
  const unsubSessions = useTeamSessionStore.subscribe((s, prev) => {
    if (s.activeSessions !== prev.activeSessions || s.connections !== prev.connections) {
      syncSessions(s);
    }
  });

  reconcileAwaitingKeys(useTeamVaultStateStore.getState().statusByTeamId);
  const unsubVaultState = useTeamVaultStateStore.subscribe((s, prev) => {
    if (s.statusByTeamId !== prev.statusByTeamId) {
      reconcileAwaitingKeys(s.statusByTeamId);
    }
  });

  return () => {
    stopped = true;
    unsubInvites();
    unsubSessions();
    unsubVaultState();
  };
}
