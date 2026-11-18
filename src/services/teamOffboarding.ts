import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember } from "@/services/teamService";
import { useHistoryStore } from "@/stores/historyStore";
import { runTeamAction } from "@/services/teamActionFeedback";
import { userFacingReason } from "@/services/errorReason";
import { memberLabel } from "@/services/memberLabel";

export type DepartMode = "remove" | "leave";

export interface DepartConsequences {
  title: string;
  points: string[];
  confirmLabel: string;
}

/**
 * Why a team disappeared from this client's own list, when this client is the
 * one that caused it.
 *
 * - `leave` still needs the full offboarding — the vault really has left this
 *   device — and only suppresses the "you were removed" notice.
 * - `self-deleted` is a team this client destroyed while owning it (make
 *   private, or a rolled-back conversion). Nothing was taken away: the objects
 *   now live locally under the *same* ids, so an offboarding would wipe the
 *   user's own credentials and tell them they were kicked (#249).
 */
export type SelfDeparture = "leave" | "self-deleted";

// Held between the request and the server's membership_changed arriving back:
// that event carries no reason, so intent has to be recorded locally.
const selfDepartures = new Map<string, SelfDeparture>();

/** The kind of self-inflicted departure still echoing back, if any. */
export function selfDeparture(teamId: string): SelfDeparture | undefined {
  return selfDepartures.get(teamId);
}

export function markSelfDeparture(teamId: string, kind: SelfDeparture): void {
  selfDepartures.set(teamId, kind);
  // A stale marker would only suppress a later genuine removal notice, so it
  // must not outlive the round trip.
  setTimeout(() => selfDepartures.delete(teamId), 30_000);
}

/**
 * Pure, so a render can call it. The copy is deliberately blunt about what a
 * departure does and does not undo: the vault leaves their devices, but
 * anything they already read stays read.
 */
export function departConsequences(mode: DepartMode, names: string[]): DepartConsequences {
  if (mode === "leave") {
    return {
      title: i18n.t("members.offboarding.leaveTitle"),
      points: [
        i18n.t("members.offboarding.leavePointAccessEnds"),
        i18n.t("members.offboarding.leavePointLocalWipe"),
        i18n.t("members.offboarding.leavePointIrreversible"),
      ],
      confirmLabel: i18n.t("members.offboarding.leaveConfirm"),
    };
  }
  const count = names.length;
  return {
    title: i18n.t("members.offboarding.removeTitle", { count, names: names.join(", ") }),
    points: [
      i18n.t("members.offboarding.pointAccessEnds"),
      i18n.t("members.offboarding.pointLocalWipe"),
      i18n.t("members.offboarding.pointAlreadySeen"),
      i18n.t("members.offboarding.pointSessions"),
    ],
    confirmLabel: i18n.t("members.offboarding.removeConfirm", { count }),
  };
}

/** The builtin role an invitation can restore exactly, or null when the member's roles don't fit in one. */
function invitableRole(teamId: string, roleIds: string[]): string | null {
  if (roleIds.length !== 1) return null;
  const role = (useTeamStore.getState().rolesByTeam[teamId] ?? []).find((r) => r.id === roleIds[0]);
  return role?.is_builtin && role.name !== "owner" ? role.name : null;
}

/**
 * The single removal path. Every call site — detail panel, context menu, bulk
 * selection and leave — routes through here, so the confirmation copy, the undo
 * entry and the toast exist once rather than four times.
 */
export async function departMembers(
  teamId: string,
  members: TeamMember[],
  opts: { mode: DepartMode; onDone?: () => void },
): Promise<void> {
  if (members.length === 0) return;

  const snapshots = members.map((m) => ({ user_id: m.user_id, role: invitableRole(teamId, m.role_ids), label: memberLabel(m, "") }));
  const count = members.length;
  const names = snapshots.map((s) => s.label).join(", ");
  const store = () => useTeamStore.getState();

  if (opts.mode === "leave") markSelfDeparture(teamId, "leave");

  const { removed } = await runTeamAction({
    pending: opts.mode === "leave"
      ? i18n.t("members.toast.leavingTeam")
      : i18n.t("members.toast.removingMember", { name: names }),
    success: opts.mode === "leave"
      ? i18n.t("members.toast.leftTeam")
      : i18n.t("members.toast.memberRemoved", { name: names, count }),
    warning: ({ removed, failed }) => failed.length === 0 ? null : i18n.t("members.error.removePartial", {
      removed: removed.map((s) => s.label).join(", "),
      failed: failed.map((f) => f.label).join(", "),
      reason: userFacingReason(failed[0].error),
    }),
    // Same failure copy as the single-member helper in vaultShare; this path
    // keeps one toast for the whole batch rather than nesting N of them.
    error: (e: Error) =>
      i18n.t("members.error.removeFailed", { name: names, reason: userFacingReason(e) }),
    run: async () => {
      const removed: typeof snapshots = [];
      const failed: { label: string; error: Error }[] = [];
      for (const s of snapshots) {
        try {
          await store().removeMember(teamId, s.user_id);
          removed.push(s);
        } catch (e) {
          failed.push({ label: s.label, error: e instanceof Error ? e : new Error(String(e)) });
        }
      }
      if (removed.length === 0) throw failed[0].error;
      if (failed.length > 0) await store().loadMembers(teamId).catch(() => {});
      return { removed, failed };
    },
  });

  // No undo for leaving: re-adding yourself to a team you left is not a call
  // you are authorised to make.
  if (opts.mode === "remove") {
    const removedNames = removed.map((s) => s.label).join(", ");
    useHistoryStore.getState().push({
      label: i18n.t("members.history.remove", { name: removedNames, count: removed.length }),
      undo: async () => {
        // An invitation carries one builtin role, applied on accept; anything else would come back as the default.
        const unrestorable = removed.filter((s) => !s.role).map((s) => s.label);
        if (unrestorable.length > 0) {
          throw new Error(i18n.t("members.error.undoRolesNotRestorable", { name: unrestorable.join(", ") }));
        }
        for (const s of removed) if (s.role) await store().addMemberById(teamId, s.user_id, s.role);
        await store().loadMembers(teamId);
      },
      redo: async () => {
        for (const s of removed) await store().removeMember(teamId, s.user_id);
        await store().loadMembers(teamId);
      },
    });
  }

  opts.onDone?.();
}
