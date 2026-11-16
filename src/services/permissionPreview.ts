import i18n from "@/i18n";
import { refuseIfPlanRequired } from "@/services/planRequired";
import { serverFetch } from "@/services/teamService";

export interface RuleLayers {
  everyone_allow: number;
  everyone_deny: number;
  roles_allow: number;
  roles_deny: number;
  member_allow: number;
  member_deny: number;
}

export interface Preview {
  team_bits: number;
  objects: Record<string, { mask: number; rule_set_id: string | null }>;
  rule_sets: Record<string, RuleLayers>;
  holds_vault_key_gate: boolean;
}

export type PreviewSubject = { type: "member"; user_id: string } | { type: "role"; role_id: string };
export type MemberDraft = { role_ids: string[]; allow: number; deny: number };
export type RoleDraft = { permissions: number };
export type PreviewDraft = MemberDraft | RoleDraft;

export interface PreviewRequest {
  subject: PreviewSubject;
  draft?: PreviewDraft;
  scope?: "full" | "vault_key_gate";
}

export interface PreviewResponse {
  locked: boolean;
  current: Preview;
  draft: Preview | null;
  affected: { changed: string[]; lose_vault_key: string[] } | null;
}

export class PreviewSubjectGoneError extends Error {
  readonly status = 404;
  constructor() {
    super(i18n.t("members.viewAs.ended"));
    this.name = "PreviewSubjectGoneError";
  }
}

export async function previewPermissions(teamId: string, req: PreviewRequest): Promise<PreviewResponse> {
  const { subject, draft, scope } = req;
  const res = await serverFetch(`/v1/teams/${teamId}/permissions/preview`, {
    method: "POST",
    body: JSON.stringify({
      subject,
      ...(draft !== undefined && { draft }),
      ...(scope !== undefined && { scope }),
    }),
  });
  if (res.ok) return res.json();
  refuseIfPlanRequired(res);
  if (res.status === 404) throw new PreviewSubjectGoneError();
  if (res.status === 403) throw Object.assign(new Error(i18n.t("members.viewAs.noPermission")), { status: 403 });
  throw new Error(i18n.t("members.viewAs.failed"));
}

export async function losesVaultKey(teamId: string, userId: string, next: MemberDraft): Promise<boolean> {
  const { current, draft } = await previewPermissions(teamId, {
    subject: { type: "member", user_id: userId },
    draft: next,
    scope: "vault_key_gate",
  });
  return current.holds_vault_key_gate && !draft?.holds_vault_key_gate;
}
