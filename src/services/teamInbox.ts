import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import type { InboxEntry, InboxKind } from "@/stores/notificationStore";
import { useTeamStore } from "@/stores/teamStore";
import { acceptInvitation, declineInvitation } from "@/services/invitationActions";
import type { MyPendingInvitation } from "@/services/teamService";

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

export function startTeamInbox(): () => void {
  reconcileInvites(useTeamStore.getState().myPendingInvitations);
  return useTeamStore.subscribe((s, prev) => {
    if (s.myPendingInvitations !== prev.myPendingInvitations) {
      reconcileInvites(s.myPendingInvitations);
    }
  });
}
