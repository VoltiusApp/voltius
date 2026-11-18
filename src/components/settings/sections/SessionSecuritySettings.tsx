import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import { systemAuthAvailable } from "@/services/appLock";
import { systemAuthMethodKey } from "@/hooks/useSystemAuthPrompt";
import { useSecurityStore, type LockAction } from "@/stores/securityStore";
import { canLockApp, canLockVault } from "@/utils/accountMode";
import { useIsMobile, usePlatform } from "@/utils/platform";
import { SETTINGS_SURFACE, SettingRow } from "./shared";
import { SettingMark } from "@/components/settings/Setting";
import { useSettingState } from "@/components/settings/registry/useSettingState";
import { IMMEDIATELY, sessionTimeoutLabel, sessionTimeoutOptions, sessionTimeoutValue } from "@/utils/sessionTimeout";
import { useEffectiveLockSettings } from "@/hooks/useEffectiveLockSettings";
import { ManagedNote, ManagedWhen, RangeNote } from "@/components/shared/ManagedNote";
import { inPolicyRange } from "@/services/policy/range";
import { usePolicyLock, usePolicyRange, type PolicyRange } from "@/stores/policyStore";
import { lockActionSetting, sessionTimeoutSetting } from "@/stores/securityStore";
import {
  bindNow, bindingStatus, disableBinding, disableWithPassword, enableBinding, type BindingStatus,
} from "@/services/vaultBinding";
import { startRememberingMasterPassword, stopRememberingMasterPassword } from "@/services/masterPasswordMemory";
import { keepsPlainPassword } from "@/services/vaultSecret";
import { BindPasswordDialog } from "./BindPasswordDialog";

export function SessionSecuritySettings({ mode }: { mode: string | null }) {
  const timeoutState = useSettingState("security.sessionTimeoutMinutes");
  const actionState = useSettingState("security.lockAction");
  const { t } = useTranslation();
  const platform = usePlatform();
  const isMobile = useIsMobile();
  const { sessionTimeoutMinutes, lockAction, limit } = useEffectiveLockSettings();
  const timeoutLock = usePolicyLock(sessionTimeoutSetting.key);
  const timeoutRange = usePolicyRange(sessionTimeoutSetting.key);
  const actionLock = usePolicyLock(lockActionSetting.key);
  const actionRange = usePolicyRange(lockActionSetting.key);
  const setSessionTimeoutMinutes = useSecurityStore((s) => s.setSessionTimeoutMinutes);
  const setLockAction = useSecurityStore((s) => s.setLockAction);
  const systemAuthUnlock = useSecurityStore((s) => s.systemAuthUnlock);
  const setSystemAuthUnlock = useSecurityStore((s) => s.setSystemAuthUnlock);
  const [providerAvailable, setProviderAvailable] = useState(false);

  const [status, setStatus] = useState<BindingStatus | null>(null);
  const [dialog, setDialog] = useState<"enable" | "disable" | "remember" | null>(null);
  const [rememberError, setRememberError] = useState("");
  const [rememberPassword, setRememberPassword] = useState<boolean | null>(null);
  const refreshRemember = () => { void keepsPlainPassword().then(setRememberPassword); };
  useEffect(refreshRemember, []);

  useEffect(() => { void systemAuthAvailable().then(setProviderAvailable); }, []);
  const refreshStatus = () => { void bindingStatus(mode).then(setStatus); };
  useEffect(refreshStatus, [mode, systemAuthUnlock]);

  const onRememberToggle = async (on: boolean) => {
    setRememberError("");
    if (on) return setDialog("remember");
    await stopRememberingMasterPassword().catch(() =>
      setRememberError(t("settings.account.sessionSecurity.rememberPassword.removeFailed")));
    refreshRemember();
  };

  const reason = t("layout.appLock.sealReason");
  const finish = (on: boolean) => {
    setSystemAuthUnlock(on);
    setDialog(null);
    refreshStatus();
  };
  const onToggle = async (on: boolean) => {
    if (on) {
      if (status === "unbound") setDialog("enable");
      else setSystemAuthUnlock(true);
      return;
    }
    if ((await disableBinding(reason)) === "ok") finish(false);
    else setDialog("disable");
  };

  const lockable = canLockApp(mode, systemAuthUnlock);
  const vaultLockable = canLockVault(mode);
  const systemAuthNeedsRemembered = vaultLockable && rememberPassword === false && status === "os-login";
  const effectiveAction: LockAction = vaultLockable ? lockAction : "screen";
  const timeoutLabel = (v: unknown) => sessionTimeoutLabel(t, sessionTimeoutValue(v as number | null));
  const actionLabel = (v: unknown) => t(`settings.account.sessionSecurity.lockAction.${v === "vault" ? "vault" : "screen"}`);
  const noteLine = (node: ReactNode) => <p className="text-xs text-(--t-text-muted)">{node}</p>;
  const setBy = (teams: string[] | undefined, text: (teams: string) => string) =>
    teams?.length ? text(teams.join(", ")) : <ManagedNote />;
  const rangeNote = (range: PolicyRange, format: (v: unknown) => string) => <RangeNote range={range} format={format} />;

  const maxOnly = timeoutRange?.min === undefined && timeoutRange?.allowed === undefined ? timeoutRange?.max : undefined;
  const timeoutNote = timeoutLock.locked
    ? <ManagedNote teams={timeoutLock.teams} />
    : maxOnly !== undefined
      ? setBy(limit?.teams.timeout, (teams) => maxOnly === IMMEDIATELY
          ? t("settings.account.sessionSecurity.policy.timeoutImmediately", { teams })
          : t("settings.account.sessionSecurity.policy.timeout", { teams, duration: timeoutLabel(maxOnly) }))
      : timeoutRange && rangeNote(timeoutRange, timeoutLabel);
  const actionNote = actionLock.locked
    ? actionLock.value === "vault"
      ? setBy(limit?.teams.vault, (teams) => t("settings.account.sessionSecurity.policy.vault", { teams }))
      : <ManagedNote teams={actionLock.teams} />
    : actionRange && rangeNote(actionRange, actionLabel);

  const allActions = [
    ...(vaultLockable ? [{ value: "vault", label: actionLabel("vault") }] : []),
    { value: "screen", label: actionLabel("screen") },
  ];
  const actionOptions = vaultLockable
    ? allActions.filter((o) => inPolicyRange(actionRange, o.value) && (!actionLock.locked || actionLock.value === o.value))
    : allActions;
  const timeoutOptions = sessionTimeoutOptions(t).filter((o) =>
    inPolicyRange(timeoutRange, o.value === "never" ? null : Number(o.value)));

  return (
    <div data-settings-card className={`${SETTINGS_SURFACE} px-4 py-3 space-y-3`}>
      <div className="space-y-1.5">
        {(() => {
          const select = (
        <ManagedWhen locked={timeoutLock.locked} note={false}>
        <FormSelect
          value={sessionTimeoutValue(sessionTimeoutMinutes)}
          options={timeoutOptions}
          ariaLabel={t("settings.account.sessionSecurity.autoLockLabel")}
          disabled={!lockable}
          onChange={(value) => {
            const next = value === "never" ? null : Number(value);
            setSessionTimeoutMinutes(Number.isFinite(next) ? next : null);
          }}
        />
        </ManagedWhen>
          );
          // Android: an M3 row with the value trailing (the picker opens as a sheet).
          return isMobile ? (
            <SettingRow title={t("settings.account.sessionSecurity.autoLockLabel")} desc={t("settings.account.sessionSecurity.autoLockDesc")} dimmed={!lockable} dirty={timeoutState.dirty} onReset={timeoutState.canReset ? timeoutState.reset : undefined}>
              {select}
            </SettingRow>
          ) : (
            <>
              <p className="text-xs text-(--t-text-dim)"><SettingMark id="security.sessionTimeoutMinutes">{t("settings.account.sessionSecurity.autoLockLabel")}</SettingMark></p>
              {select}
              <p className="text-xs text-(--t-text-dim)">{t("settings.account.sessionSecurity.autoLockDesc")}</p>
            </>
          );
        })()}
        {timeoutNote && noteLine(timeoutNote)}
      </div>

      <div className="space-y-1.5">
        {(() => {
          const select = (
            <ManagedWhen locked={actionLock.locked} note={false}>
            <FormSelect
              value={effectiveAction}
              options={actionOptions}
              ariaLabel={t("settings.account.sessionSecurity.lockAction.label")}
              disabled={!lockable}
              onChange={(value) => setLockAction(value as LockAction)}
            />
            </ManagedWhen>
          );
          const desc = t(effectiveAction === "screen"
            ? "settings.account.sessionSecurity.lockAction.screenDesc"
            : "settings.account.sessionSecurity.lockAction.vaultDesc");
          return isMobile ? (
            <SettingRow title={t("settings.account.sessionSecurity.lockAction.label")} desc={desc} dimmed={!lockable} dirty={actionState.dirty} onReset={actionState.canReset ? actionState.reset : undefined}>
              {select}
            </SettingRow>
          ) : (
            <>
              <p className="text-xs text-(--t-text-dim)"><SettingMark id="security.lockAction">{t("settings.account.sessionSecurity.lockAction.label")}</SettingMark></p>
              {select}
              <p className="text-xs text-(--t-text-dim)">{desc}</p>
            </>
          );
        })()}
        {actionNote && noteLine(actionNote)}
        {sessionTimeoutMinutes === IMMEDIATELY && effectiveAction === "vault" && (
          <p className="text-xs text-(--t-status-warning)">
            {t("settings.account.sessionSecurity.immediateVaultWarning")}
          </p>
        )}
      </div>

      {vaultLockable && rememberPassword !== null && (
        <div data-setting-row className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.account.sessionSecurity.rememberPassword.toggle")}</p>
            <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.account.sessionSecurity.rememberPassword.desc")}</p>
            {rememberError && <p role="alert" className="text-xs mt-1 text-(--t-status-error)">{rememberError}</p>}
          </div>
          <Toggle
            checked={rememberPassword}
            onChange={(on) => void onRememberToggle(on)}
            aria-label={t("settings.account.sessionSecurity.rememberPassword.toggle")}
          />
        </div>
      )}

      <div data-setting-row className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-(--t-text-primary)"><SettingMark id="security.systemAuthUnlock">{t("settings.account.sessionSecurity.systemAuth.toggle")}</SettingMark></p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">
            {providerAvailable
              ? t("settings.account.sessionSecurity.systemAuth.desc", { method: t(systemAuthMethodKey(platform)) })
              : t("settings.account.sessionSecurity.systemAuth.unavailable")}
          </p>
          {systemAuthNeedsRemembered && providerAvailable ? (
            <p className="text-xs mt-1 text-(--t-status-warning)">
              {t("settings.account.sessionSecurity.rememberPassword.systemAuthNeedsIt")}
            </p>
          ) : systemAuthUnlock && status && (
            <p className="text-xs mt-1 text-(--t-text-muted)">
              {t(`settings.account.sessionSecurity.systemAuth.status.${status}`)}
              {status === "unbound" && (
                <button
                  type="button"
                  className="ml-1 underline hover:text-(--t-text-primary)"
                  onClick={() => (rememberPassword === false ? setDialog("enable") : void bindNow(reason).then(refreshStatus))}
                >
                  {t("settings.account.sessionSecurity.systemAuth.bindNow")}
                </button>
              )}
            </p>
          )}
        </div>
        <Toggle
          checked={systemAuthUnlock}
          onChange={(on) => void onToggle(on)}
          disabled={!providerAvailable && !systemAuthUnlock}
          aria-label={t("settings.account.sessionSecurity.systemAuth.toggle")}
        />
      </div>

      {dialog === "enable" && (
        <BindPasswordDialog
          title={t("settings.account.sessionSecurity.systemAuth.enableTitle")}
          body={t("settings.account.sessionSecurity.systemAuth.enableBody")}
          onClose={() => setDialog(null)}
          onSubmit={async (password) => {
            const r = await enableBinding(password, reason);
            if (r === "wrong-password") return t("layout.appLock.wrongPassword");
            if (r === "cancelled") return null;
            if (r !== "ok") return t("layout.appLock.systemAuthFailed");
            finish(true);
            return null;
          }}
        />
      )}
      {dialog === "remember" && (
        <BindPasswordDialog
          title={t("settings.account.sessionSecurity.rememberPassword.enableTitle")}
          body={t("settings.account.sessionSecurity.rememberPassword.enableBody")}
          onClose={() => setDialog(null)}
          onSubmit={async (password) => {
            const ok = await startRememberingMasterPassword(password).catch(() => null);
            if (ok === null) return t("settings.account.sessionSecurity.rememberPassword.storeFailed");
            if (!ok) return t("layout.appLock.wrongPassword");
            refreshRemember();
            setDialog(null);
            return null;
          }}
        />
      )}
      {dialog === "disable" && (
        <BindPasswordDialog
          title={t("settings.account.sessionSecurity.systemAuth.disableTitle")}
          body={t("settings.account.sessionSecurity.systemAuth.disableBody")}
          onClose={() => setDialog(null)}
          onSubmit={async (password) => {
            if (!(await disableWithPassword(password))) return t("layout.appLock.wrongPassword");
            finish(false);
            return null;
          }}
        />
      )}

      {!lockable && (
        <p className="text-xs text-(--t-text-muted)">{t("settings.account.sessionSecurity.needsSystemAuth")}</p>
      )}
    </div>
  );
}
