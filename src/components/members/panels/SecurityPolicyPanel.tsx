import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { BusinessLapseNotice, BusinessLockCard } from "@/components/shared/BusinessLockBanner";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { runTeamAction } from "@/services/teamActionFeedback";
import type { TeamLockPolicy } from "@/services/teamService";
import { useTeamStore } from "@/stores/teamStore";
import { IMMEDIATELY, sessionTimeoutOptions } from "@/utils/sessionTimeout";

const DEFAULT_MAX_MINUTES = 15;

export function SecurityPolicyPanel({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const policy = useTeamStore((s) => s.teams.find((x) => x.id === teamId)?.lock_policy ?? null);
  const setLockPolicy = useTeamStore((s) => s.setLockPolicy);
  const { locked } = useBusinessLock(teamId);
  const [busy, setBusy] = useState(false);

  const save = async (next: TeamLockPolicy | null) => {
    setBusy(true);
    try {
      await runTeamAction({
        pending: t("members.security.saving"),
        success: t("members.security.saved"),
        run: () => setLockPolicy(teamId, next),
      });
    } catch {
      // runTeamAction already reported the failure.
    } finally {
      setBusy(false);
    }
  };

  if (locked && !policy) return <BusinessLockCard teamId={teamId} body={t("members.security.lockBody")} />;

  const disabled = busy || locked;
  return (
    <div className="space-y-4">
      <BusinessLapseNotice
        teamId={teamId}
        message={t("members.security.lapsed")}
        removeLabel={t("members.security.remove")}
        onRemove={() => save(null)}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-(--t-text-primary)">{t("members.security.enforce")}</p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("members.security.enforceDesc")}</p>
        </div>
        <Toggle
          checked={policy !== null}
          disabled={disabled}
          onChange={(on) => void save(on ? { max_minutes: DEFAULT_MAX_MINUTES, force_vault: false } : null)}
          aria-label={t("members.security.enforce")}
        />
      </div>
      {policy && (
        <>
          <div className="space-y-1.5">
            <p className="text-xs text-(--t-text-dim)">{t("members.security.maxLabel")}</p>
            <FormSelect
              value={String(policy.max_minutes)}
              options={sessionTimeoutOptions(t).filter((o) => o.value !== "never")}
              ariaLabel={t("members.security.maxLabel")}
              disabled={disabled}
              onChange={(value) => void save({ ...policy, max_minutes: Number(value) })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("members.security.forceVault")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("members.security.forceVaultDesc")}</p>
            </div>
            <Toggle
              checked={policy.force_vault}
              disabled={disabled}
              onChange={(on) => void save({ ...policy, force_vault: on })}
              aria-label={t("members.security.forceVault")}
            />
          </div>
          {policy.max_minutes === IMMEDIATELY && policy.force_vault && (
            <p className="text-xs text-(--t-status-warning)">{t("members.security.immediateVaultWarning")}</p>
          )}
        </>
      )}
      <p className="text-xs text-(--t-text-muted)">{t("members.security.appliesToAll")}</p>
    </div>
  );
}
