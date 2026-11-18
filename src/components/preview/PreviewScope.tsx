import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePreviewStore } from "@/stores/previewStore";
import { usePreviewActive } from "@/hooks/previewScope";
import { useTeamStore } from "@/stores/teamStore";
import { ruleSubjectLabel } from "@/components/members/roleChips";
import { previewObjectOf, type PreviewObject } from "@/services/previewSnapshot";

export { PreviewContentScope, useInPreviewContent, usePreviewActive } from "@/hooks/previewScope";

export function usePreviewObject(objectId: string): PreviewObject | null {
  const session = usePreviewActive();
  const result = usePreviewStore((s) => s.result);
  return useMemo(() => (session && result ? previewObjectOf(result, objectId) : null), [session, result, objectId]);
}

export function useSubjectLabel(): string {
  const { t } = useTranslation();
  const session = usePreviewStore((s) => s.session);
  const members = useTeamStore((s) => (session ? s.membersByTeam[session.teamId] : undefined));
  const roles = useTeamStore((s) => (session ? s.rolesByTeam[session.teamId] : undefined));
  if (!session) return "";
  const { subject } = session;
  const ruleSubject = subject.type === "member"
    ? { type: "member" as const, id: subject.user_id }
    : { type: "role" as const, id: subject.role_id };
  return ruleSubjectLabel(t, ruleSubject, roles ?? [], members ?? []);
}
