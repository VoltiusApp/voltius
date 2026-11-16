import { useTeamStore, type TeamMember } from "@/stores/teamStore";
import type { MemberDraft } from "@/services/permissionPreview";
import { withControlAuthority } from "@/services/previewGuard";

export interface SaveFailure {
  step: "overrides" | "addRole" | "removeRole";
  roleId?: string;
  message: string;
}

type Step = Omit<SaveFailure, "message"> & { run: () => Promise<void> };

function draftSteps(teamId: string, member: TeamMember, draft: MemberDraft): Step[] {
  const store = useTeamStore.getState();
  const steps: Step[] = [];
  if (draft.allow !== (member.permission_allow ?? 0) || draft.deny !== (member.permission_deny ?? 0)) {
    steps.push({ step: "overrides", run: () => store.setMemberPermissions(teamId, member.user_id, draft.allow, draft.deny) });
  }
  for (const roleId of draft.role_ids.filter((id) => !member.role_ids.includes(id))) {
    steps.push({ step: "addRole", roleId, run: () => store.assignMemberRole(teamId, member.user_id, roleId) });
  }
  for (const roleId of member.role_ids.filter((id) => !draft.role_ids.includes(id))) {
    steps.push({ step: "removeRole", roleId, run: () => store.removeMemberRole(teamId, member.user_id, roleId) });
  }
  return steps;
}

export const memberDraftStepCount = (teamId: string, member: TeamMember, draft: MemberDraft): number =>
  draftSteps(teamId, member, draft).length;

export async function saveMemberDraft(teamId: string, member: TeamMember, draft: MemberDraft): Promise<{ failed: SaveFailure[] }> {
  const failed: SaveFailure[] = [];
  await withControlAuthority(async () => {
    for (const { run, ...step } of draftSteps(teamId, member, draft)) {
      try {
        await run();
      } catch (e) {
        failed.push({ ...step, message: e instanceof Error ? e.message : String(e) });
      }
    }
  });
  return { failed };
}
