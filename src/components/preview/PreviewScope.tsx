import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePreviewStore, type PreviewSession } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { PERM_BITS } from "@/services/permissions";
import { ruleSubjectLabel } from "@/components/members/roleChips";

const PreviewContentContext = createContext(false);

export function PreviewContentScope({ children }: { children: ReactNode }) {
  return <PreviewContentContext.Provider value>{children}</PreviewContentContext.Provider>;
}

export const useInPreviewContent = (): boolean => useContext(PreviewContentContext);

export function usePreviewActive(): PreviewSession | null {
  const inContent = useInPreviewContent();
  const session = usePreviewStore((s) => s.session);
  return inContent ? session : null;
}

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
    const mask = result.draft?.objects[objectId]?.mask ?? current.mask;
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
