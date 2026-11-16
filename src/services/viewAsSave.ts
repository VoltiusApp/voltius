import { useTeamStore, type TeamMember, type TeamRole } from "@/stores/teamStore";
import type { MemberDraft, PreviewDraft, RoleDraft } from "@/services/permissionPreview";
import { withControlAuthority } from "@/services/previewGuard";

export interface SaveFailure {
  step: "overrides" | "addRole" | "removeRole";
  roleId?: string;
  message: string;
}

const popcount = (n: number): number => {
  let count = 0;
  for (let v = n >>> 0; v; v &= v - 1) count++;
  return count;
};

const roleDiff = (draftIds: string[], savedIds: string[]) => ({
  added: draftIds.filter((id) => !savedIds.includes(id)),
  removed: savedIds.filter((id) => !draftIds.includes(id)),
});

const maskChanged = (draft: MemberDraft, member: TeamMember): number =>
  ((draft.allow ^ (member.permission_allow ?? 0)) | (draft.deny ^ (member.permission_deny ?? 0)));

export function unsavedChangeCount(draft: PreviewDraft, current: TeamMember | TeamRole | undefined): number {
  if (!current) return 0;
  if ("permissions" in draft) return popcount(draft.permissions ^ (current as TeamRole).permissions);
  const member = current as TeamMember;
  const { added, removed } = roleDiff(draft.role_ids, member.role_ids);
  return added.length + removed.length + popcount(maskChanged(draft, member));
}

type Step = Omit<SaveFailure, "message"> & { run: () => Promise<void> };

function draftSteps(teamId: string, member: TeamMember, draft: MemberDraft): Step[] {
  const store = useTeamStore.getState();
  const steps: Step[] = [];
  const { added, removed } = roleDiff(draft.role_ids, member.role_ids);
  if (maskChanged(draft, member) !== 0) {
    steps.push({ step: "overrides", run: () => store.setMemberPermissions(teamId, member.user_id, draft.allow, draft.deny) });
  }
  for (const roleId of added) {
    steps.push({ step: "addRole", roleId, run: () => store.assignMemberRole(teamId, member.user_id, roleId) });
  }
  for (const roleId of removed) {
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

export async function saveRoleDraft(teamId: string, roleId: string, draft: RoleDraft): Promise<{ failed: SaveFailure[] }> {
  await withControlAuthority(() => useTeamStore.getState().updateRole(teamId, roleId, { permissions: draft.permissions }));
  return { failed: [] };
}
