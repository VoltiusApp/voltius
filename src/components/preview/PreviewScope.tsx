import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePreviewStore } from "@/stores/previewStore";
import { usePreviewActive } from "@/hooks/previewScope";
import { useTeamStore } from "@/stores/teamStore";
import { PERM_BITS } from "@/services/permissions";
import { ruleSubjectLabel } from "@/components/members/roleChips";
import { previewSideOf } from "@/services/previewSnapshot";

export { PreviewContentScope, useInPreviewContent, usePreviewActive } from "@/hooks/previewScope";

export interface PreviewObject {
  hidden: boolean;
  mask: number;
  currentMask: number;
  changed: boolean;
}

export function usePreviewObject(objectId: string): PreviewObject | null {
  const session = usePreviewActive();
  const result = usePreviewStore((s) => s.result);
  return useMemo(() => {
    const current = result?.current.objects[objectId];
    if (!session || !result || !current) return null;
    const mask = previewSideOf(result, objectId).objects[objectId].mask;
    return {
      hidden: (mask & PERM_BITS.VIEW) === 0,
      mask,
      currentMask: current.mask,
      changed: result.draft !== null && mask !== current.mask,
    };
  }, [session, result, objectId]);
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
