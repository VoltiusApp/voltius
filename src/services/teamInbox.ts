import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import type { InboxEntry, InboxKind } from "@/stores/notificationStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { acceptInvitation, declineInvitation } from "@/services/invitationActions";
import { getCurrentUserEmail } from "@/services/account";
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
  await useTeamSessionStore.getState().joinSession(session.id, displayName, () => {});
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

export function startTeamInbox(): () => void {
  reconcileInvites(useTeamStore.getState().myPendingInvitations);
  const unsubInvites = useTeamStore.subscribe((s, prev) => {
    if (s.myPendingInvitations !== prev.myPendingInvitations) {
      reconcileInvites(s.myPendingInvitations);
    }
  });

  const syncSessions = () => {
    const st = useTeamSessionStore.getState();
    const joined = new Set(Object.values(st.connections).map((c) => c.multiplayerSessionId));
    reconcileSessions(st.activeSessions, joined);
  };
  syncSessions();
  const unsubSessions = useTeamSessionStore.subscribe(syncSessions);

  return () => {
    unsubInvites();
    unsubSessions();
  };
}
