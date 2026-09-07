import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember } from "@/services/teamService";
import { useHistoryStore } from "@/stores/historyStore";
import { runTeamAction } from "@/services/teamActionFeedback";

export type DepartMode = "remove" | "leave";

export interface DepartConsequences {
  title: string;
  points: string[];
  confirmLabel: string;
}

// Set between calling the removal endpoint for yourself and the server's
// membership_changed arriving back, so the "you were removed" notice does not
// fire at someone who left on purpose.
const voluntaryDepartures = new Set<string>();

/** True while a leave this client initiated is still echoing back from the server. */
export function departedVoluntarily(teamId: string): boolean {
  return voluntaryDepartures.has(teamId);
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

  if (opts.mode === "leave") {
    voluntaryDepartures.add(teamId);
    // A stale marker would only suppress a later genuine removal notice, so it
    // must not outlive the round trip.
    setTimeout(() => voluntaryDepartures.delete(teamId), 30_000);
  }

  await runTeamAction({
    pending: opts.mode === "leave"
      ? i18n.t("members.toast.leavingTeam")
      : i18n.t("members.toast.removingMember", { name: names }),
    success: opts.mode === "leave"
      ? i18n.t("members.toast.leftTeam")
      : i18n.t("members.toast.memberRemoved", { name: names, count }),
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
