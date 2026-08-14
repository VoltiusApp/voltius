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
import type { MyPendingInvitation } from "@/services/teamService";
import type { ActiveSession } from "@/services/multiplayerService";

const APP_SOURCE = { kind: "app", area: "team" } as const;

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

export function reconcileSessions(sessions: ActiveSession[], joinedSessionIds: Set<string>): void {
  reconcile(
    ["sessionShared"],
    sessions.map((s) => {
      const joined = joinedSessionIds.has(s.id);
      return {
        id: `session:${s.id}`,
        kind: "sessionShared" as const,
        message: i18n.t("notifications.inbox.session.message", { name: s.connection_name }),
        state: joined ? ("resolved" as const) : undefined,
        resolution: joined ? i18n.t("notifications.inbox.session.joined") : undefined,
        actions: joined
          ? []
          : [{ label: i18n.t("notifications.inbox.session.join"), run: () => joinSharedSession(s) }],
      };
    }),
  );
}

export function reconcileControlRequests(connections: Record<string, MultiplayerSessionState>): void {
  const entries = Object.entries(connections)
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
            run: async () => useNotificationStore.getState().retractInbox(id),
          },
        ],
      };
    });

  // Toast only for requests not already in the inbox, so repeated reconciles stay silent.
  const known = new Set(
    useNotificationStore.getState().inbox.filter((e) => e.kind === "controlRequest").map((e) => e.id),
  );
  for (const e of entries) {
    if (!known.has(e.id)) {
      useNotificationStore.getState().addToast({
        source: APP_SOURCE,
        type: "toast",
        message: e.message,
        severity: "info",
        duration: 8000,
      });
    }
  }

  reconcile(["controlRequest"], entries);
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
  reconcileInvites(useTeamStore.getState().myPendingInvitations);
  const unsubInvites = useTeamStore.subscribe((s, prev) => {
    if (s.myPendingInvitations !== prev.myPendingInvitations) {
      reconcileInvites(s.myPendingInvitations);
    }
  });

  const syncSessions = (st: ReturnType<typeof useTeamSessionStore.getState>) => {
    const joined = new Set(Object.values(st.connections).map((c) => c.multiplayerSessionId));
    reconcileSessions(st.activeSessions, joined);
    reconcileControlRequests(st.connections);
  };
  syncSessions(useTeamSessionStore.getState());
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
    unsubInvites();
    unsubSessions();
    unsubVaultState();
  };
}
