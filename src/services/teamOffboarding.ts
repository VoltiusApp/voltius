import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember } from "@/services/teamService";
import { useHistoryStore } from "@/stores/historyStore";
import { runTeamAction } from "@/services/teamActionFeedback";
import { userFacingReason } from "@/services/errorReason";

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

  const snapshots = members.map((m) => ({ user_id: m.user_id, role_ids: [...m.role_ids] }));
  const count = members.length;
  const names = members.map((m) => m.handle ?? "").join(", ");
  const store = () => useTeamStore.getState();

  if (opts.mode === "leave") markSelfDeparture(teamId, "leave");

  await runTeamAction({
    pending: opts.mode === "leave"
      ? i18n.t("members.toast.leavingTeam")
      : i18n.t("members.toast.removingMember", { name: names }),
    success: opts.mode === "leave"
      ? i18n.t("members.toast.leftTeam")
      : i18n.t("members.toast.memberRemoved", { name: names, count }),
    // Same failure copy as the single-member helper in vaultShare; this path
    // keeps one toast for the whole batch rather than nesting N of them.
    error: (e: Error) =>
      i18n.t("members.error.removeFailed", { name: names, reason: userFacingReason(e) }),
    run: async () => {
      for (const m of members) await store().removeMember(teamId, m.user_id);
    },
  });

  // No undo for leaving: re-adding yourself to a team you left is not a call
  // you are authorised to make.
  if (opts.mode === "remove") {
    useHistoryStore.getState().push({
      label: i18n.t("members.history.remove", { name: names, count }),
      undo: async () => {
        for (const s of snapshots) {
          await store().addMemberById(teamId, s.user_id);
          for (const rid of s.role_ids) {
            await store().assignMemberRole(teamId, s.user_id, rid).catch(() => {});
          }
        }
        await store().loadMembers(teamId);
      },
      redo: async () => {
        for (const s of snapshots) await store().removeMember(teamId, s.user_id);
        await store().loadMembers(teamId);
      },
    });
  }

  opts.onDone?.();
}
