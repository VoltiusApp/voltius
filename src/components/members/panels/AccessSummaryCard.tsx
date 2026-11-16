import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { UpgradeAction } from "@/components/shared/BusinessLockBanner";
import { countAccess } from "@/components/preview/accessCounts";
import { useViewAsEntry } from "@/components/preview/useViewAsEntry";
import { previewPermissions, type Preview } from "@/services/permissionPreview";
import { memberLabel } from "@/services/memberLabel";
import { useTeamObjectAccessStore, type TeamAccessEntries } from "@/stores/teamObjectAccessStore";
import { isMobileShell } from "@/utils/platform";
import type { TeamMember } from "@/stores/teamStore";

const NO_ENTRIES: TeamAccessEntries = {};

function useCurrentPreview(teamId: string, userId: string, enabled: boolean): Preview | null {
  const [current, setCurrent] = useState<Preview | null>(null);
  useEffect(() => {
    setCurrent(null);
    if (!enabled) return;
    let live = true;
    previewPermissions(teamId, { subject: { type: "member", user_id: userId }, scope: "full" })
      .then((r) => { if (live) setCurrent(r.current); })
      .catch(() => {});
    return () => { live = false; };
  }, [teamId, userId, enabled]);
  return current;
}

export function AccessSummaryCard({ teamId, member }: { teamId: string; member: TeamMember }) {
  const { t } = useTranslation();
  const entry = useViewAsEntry(teamId, { type: "member", user_id: member.user_id });
  const entries = useTeamObjectAccessStore((s) => s.byTeam[teamId]) ?? NO_ENTRIES;
  const current = useCurrentPreview(teamId, member.user_id, entry.enabled);
  const counts = useMemo(() => (current ? countAccess(entries, current) : null), [current, entries]);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        data-testid="access-summary-card"
        {...entry.button}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-[var(--r-md)] text-left bg-(--t-bg-card) disabled:opacity-60 ${isMobileShell() ? "min-h-12" : ""}`}
        style={{ boxShadow: "var(--t-ring)" }}
      >
        <Icon icon="lucide:scan-eye" width={16} className="shrink-0 text-(--t-accent)" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-(--t-text-primary)">
            {t("members.viewAs.summary.title", { name: memberLabel(member) })}
          </span>
          {counts && (
            <span className="block text-[11px] text-(--t-text-dim)">{t("members.viewAs.summary.counts", { ...counts })}</span>
          )}
        </span>
        <Icon icon="lucide:chevron-right" width={13} className="shrink-0 text-(--t-text-dim)" />
      </button>
      {entry.reasonText && <p className="text-[11px] px-1 text-(--t-text-dim)">{entry.reasonText}</p>}
      {entry.reason === "needsBusiness" && <UpgradeAction teamId={teamId} look="link" />}
    </div>
  );
}
