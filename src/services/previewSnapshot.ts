import type { PermissionSnapshot } from "@/services/permissions";
import type { Preview, PreviewDraft, PreviewResponse, PreviewSubject } from "@/services/permissionPreview";
import type { TeamMember, TeamRole } from "@/services/teamService";
import type { TeamAccessEntries } from "@/stores/teamObjectAccessStore";

export const PREVIEW_ROLE_USER_ID = "preview:role";

export interface PreviewSession {
  teamId: string;
  vaultId: string;
  subject: PreviewSubject;
}

export const previewSubjectUserId = (subject: PreviewSubject): string =>
  subject.type === "member" ? subject.user_id : PREVIEW_ROLE_USER_ID;

export const shownPreview = (result: PreviewResponse): Preview => result.draft ?? result.current;

export function previewSideOf(result: PreviewResponse, objectId: string): Preview {
  const shown = shownPreview(result);
  return shown.objects[objectId] ? shown : result.current;
}

export function subjectMembers(teamId: string, members: TeamMember[], subject: PreviewSubject, draft: PreviewDraft | null): TeamMember[] {
  if (subject.type === "role") {
    return [...members, {
      team_id: teamId, user_id: PREVIEW_ROLE_USER_ID, invited_by_display_name: null, joined_at: "", public_key: "",
      role_ids: [subject.role_id],
    }];
  }
  if (!draft || !("role_ids" in draft)) return members;
  return members.map((m) => m.user_id === subject.user_id
    ? { ...m, role_ids: draft.role_ids, permission_allow: draft.allow, permission_deny: draft.deny }
    : m);
}

export function subjectRoles(roles: TeamRole[], subject: PreviewSubject, draft: PreviewDraft | null): TeamRole[] {
  return subject.type === "role" && draft && "permissions" in draft
    ? roles.map((r) => (r.id === subject.role_id ? { ...r, permissions: draft.permissions } : r))
    : roles;
}

export function previewSnapshot<S extends Omit<PermissionSnapshot, "vaults">>(
  base: S, session: PreviewSession, draft: PreviewDraft | null, result: PreviewResponse,
): S {
  const { teamId, subject } = session;
  const shown = shownPreview(result);
  const access: TeamAccessEntries = {};
  for (const [id, entry] of Object.entries(base.objectAccess?.[teamId] ?? {})) {
    const object = shown.objects[id];
    if (object) access[id] = { ...entry, myPermissions: object.mask };
  }
  return {
    ...base,
    myUserId: previewSubjectUserId(subject),
    membersByTeam: { ...base.membersByTeam, [teamId]: subjectMembers(teamId, base.membersByTeam[teamId] ?? [], subject, draft) },
    rolesByTeam: { ...base.rolesByTeam, [teamId]: subjectRoles(base.rolesByTeam[teamId] ?? [], subject, draft) },
    objectAccess: { ...base.objectAccess, [teamId]: access },
    teamBits: { ...base.teamBits, [teamId]: shown.team_bits },
  };
}
