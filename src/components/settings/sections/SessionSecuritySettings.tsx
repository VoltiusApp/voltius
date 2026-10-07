import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { systemAuthAvailable } from "@/services/appLock";
import { systemAuthMethodKey } from "@/hooks/useSystemAuthPrompt";
import { useSecurityStore, type LockAction } from "@/stores/securityStore";
import { canLockApp, canLockVault } from "@/utils/accountMode";
import { usePlatform } from "@/utils/platform";
import { IMMEDIATELY, sessionTimeoutOptions, sessionTimeoutValue } from "@/utils/sessionTimeout";

export function SessionSecuritySettings({ mode }: { mode: string | null }) {
  const { t } = useTranslation();
  const platform = usePlatform();
  const sessionTimeoutMinutes = useSecurityStore((s) => s.sessionTimeoutMinutes);
  const setSessionTimeoutMinutes = useSecurityStore((s) => s.setSessionTimeoutMinutes);
  const lockAction = useSecurityStore((s) => s.lockAction);
  const setLockAction = useSecurityStore((s) => s.setLockAction);
  const systemAuthUnlock = useSecurityStore((s) => s.systemAuthUnlock);
  const setSystemAuthUnlock = useSecurityStore((s) => s.setSystemAuthUnlock);
  const [providerAvailable, setProviderAvailable] = useState(false);

  useEffect(() => { void systemAuthAvailable().then(setProviderAvailable); }, []);

  const lockable = canLockApp(mode, systemAuthUnlock);
  const vaultLockable = canLockVault(mode);
  const effectiveAction: LockAction = vaultLockable ? lockAction : "screen";
  const actionOptions = [
    ...(vaultLockable ? [{ value: "vault", label: t("settings.account.sessionSecurity.lockAction.vault") }] : []),
    { value: "screen", label: t("settings.account.sessionSecurity.lockAction.screen") },
  ];

  return (
    <div className="rounded-lg px-4 py-3 space-y-3 bg-(--t-bg-elevated) border border-(--t-border)">
      <div className="space-y-1.5">
        <p className="text-xs text-(--t-text-dim)">{t("settings.account.sessionSecurity.autoLockLabel")}</p>
        <FormSelect
          value={sessionTimeoutValue(sessionTimeoutMinutes)}
          options={sessionTimeoutOptions(t)}
          ariaLabel={t("settings.account.sessionSecurity.autoLockLabel")}
          disabled={!lockable}
          onChange={(value) => {
            const next = value === "never" ? null : Number(value);
            setSessionTimeoutMinutes(Number.isFinite(next) ? next : null);
          }}
        />
        <p className="text-xs text-(--t-text-dim)">{t("settings.account.sessionSecurity.autoLockDesc")}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-(--t-text-dim)">{t("settings.account.sessionSecurity.lockAction.label")}</p>
        <FormSelect
          value={effectiveAction}
          options={actionOptions}
          ariaLabel={t("settings.account.sessionSecurity.lockAction.label")}
          disabled={!lockable}
          onChange={(value) => setLockAction(value as LockAction)}
        />
        <p className="text-xs text-(--t-text-dim)">
          {t(effectiveAction === "screen"
            ? "settings.account.sessionSecurity.lockAction.screenDesc"
            : "settings.account.sessionSecurity.lockAction.vaultDesc")}
        </p>
        {sessionTimeoutMinutes === IMMEDIATELY && effectiveAction === "vault" && (
          <p className="text-xs text-(--t-status-warning)">
            {t("settings.account.sessionSecurity.immediateVaultWarning")}
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.account.sessionSecurity.systemAuth.toggle")}</p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">
            {providerAvailable
              ? t("settings.account.sessionSecurity.systemAuth.desc", { method: t(systemAuthMethodKey(platform)) })
              : t("settings.account.sessionSecurity.systemAuth.unavailable")}
          </p>
          {systemAuthUnlock && (
            <p className="text-xs mt-1 text-(--t-text-muted)">{t("settings.account.sessionSecurity.systemAuth.disclosure")}</p>
          )}
        </div>
        <Toggle
          checked={systemAuthUnlock}
          onChange={setSystemAuthUnlock}
          disabled={!providerAvailable && !systemAuthUnlock}
          aria-label={t("settings.account.sessionSecurity.systemAuth.toggle")}
        />
      </div>

      {!lockable && (
        <p className="text-xs text-(--t-text-muted)">{t("settings.account.sessionSecurity.needsSystemAuth")}</p>
      )}
    </div>
  );
}
