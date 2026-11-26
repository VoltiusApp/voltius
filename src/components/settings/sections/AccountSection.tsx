import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { Trans, useTranslation } from "react-i18next";
import { getAccountMode, getCurrentUserEmail, getMe, setMasterPassword, type MeResponse } from "@/services/account";
import { useSignOutConfirm } from "@/hooks/useSignOutConfirm";
import { lockApp } from "@/services/appLock";
import { resetVault } from "@/services/vault";
import { useSecurityStore } from "@/stores/securityStore";
import { ActionItem, FormButtons, SETTINGS_SURFACE, SettingsInput } from "./shared";
import { HandleCard } from "./HandleCard";
import { VaultBackups } from "@/components/shared/VaultBackups";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { usePlanDisplay } from "@/services/planDisplay";
import { openPortal } from "@/utils/billing";
import { useSeatReadout } from "@/hooks/useSeatReadout";
import { seatsUsedText } from "@/services/seatMath";
import { startTrialOrCheckout } from "@/services/promos";
import { TEAMS_TRIAL_DAYS } from "@/services/billingTrial";
import { UpgradeStrip } from "@/components/shared/UpgradeStrip";
import { updateInvitePreferences } from "@/services/teamService";
import { Toggle } from "@/components/shared/Toggle";
import { canLockApp } from "@/utils/accountMode";
import EditEmailModal from "./EditEmailModal";
import { SessionSecuritySettings } from "./SessionSecuritySettings";
import ChangeMasterPasswordModal from "./ChangeMasterPasswordModal";
import { TwoFactorSettings } from "./TwoFactorSettings";
import { ActiveSessionsSettings } from "./ActiveSessionsSettings";
import { formatOptionalDate, SHORT_DATE } from "@/utils/localeFormat";
import { DeleteAccountModal } from "@/components/shared/DeleteAccountModal";
import { usePlatform } from "@/utils/platform";
import { adjacentPlan, planFeatureLabel, planFeaturesFor, type PlanFeature } from "@/services/planFeatures";
import { FreeFeaturesLine } from "@/components/shared/FreeFeaturesLine";

type AccountStep = "idle" | "set-password" | "loading" | "confirm-wipe";

async function openCheckout(plan: "pro" | "teams") {
  await startTrialOrCheckout(plan, "account");
}

export default function AccountSection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<string | null>(null);
  const [step, setStep] = useState<AccountStep>("idle");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showEditEmail, setShowEditEmail] = useState(false);
  const { requestSignOut, signOutConfirm } = useSignOutConfirm((e) => setError(e instanceof Error ? e.message : String(e)));
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [allowStrangerInvites, setAllowStrangerInvites] = useState(true);
  const [strangerInvitesError, setStrangerInvitesError] = useState("");
  const [strangerInvitesLoading, setStrangerInvitesLoading] = useState(false);
  const systemAuthUnlock = useSecurityStore((s) => s.systemAuthUnlock);

  const toggleStrangerInvites = async (next: boolean) => {
    setStrangerInvitesLoading(true); // blocks the switch until this round trip resolves — a second click mid-flight can't race the first
    setAllowStrangerInvites(next);
    setStrangerInvitesError("");
    try {
      await updateInvitePreferences(next);
    } catch (e) {
      setAllowStrangerInvites(!next); // revert — the toggle can't silently drift from the server's stored value
      setStrangerInvitesError(e instanceof Error ? e.message : String(e));
    } finally {
      setStrangerInvitesLoading(false);
    }
  };

  useEffect(() => {
    getAccountMode().then(setMode).catch(() => setMode(null));
    getCurrentUserEmail().then(setCurrentEmail).catch(() => {});
    getMe().then((info) => {
      if (!info) return;
      setMe(info);
      setTwoFactorEnabled(!!info.two_factor_enabled);
      if (typeof info.allow_stranger_invites === "boolean") setAllowStrangerInvites(info.allow_stranger_invites);
    }).catch(() => {});
    setStep("idle");
    setError("");
    setSuccess("");
  }, []);

  const reset = () => {
    setStep("idle");
    setError("");
    setSuccess("");
    setPassword("");
    setConfirm("");
  };

  const wrap = async (fn: () => Promise<void>, successMsg: string) => {
    setStep("loading");
    setError("");
    try {
      await fn();
      setSuccess(successMsg);
      setMode(await getAccountMode());
      setStep("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("idle");
    }
  };

  const handleSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 4) {
      setError(t("settings.account.error.minLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("settings.account.error.mismatch"));
      return;
    }
    await wrap(() => setMasterPassword(password), t("settings.account.success.passwordSet"));
    setPassword("");
    setConfirm("");
  };

  const modeLabel =
    mode === "local-nopassword" ? t("settings.account.mode.localNoPassword") :
    mode === "local" ? t("settings.account.mode.local") :
    mode === "server" ? t("settings.account.mode.server") : t("settings.account.mode.unknown");

  const modeIcon =
    mode === "local-nopassword" ? "lucide:key-round" :
    mode === "local" ? "lucide:lock" : "lucide:cloud";

  const lockable = canLockApp(mode, systemAuthUnlock);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.account.modeTitle")}
        </h3>
        <div
          data-settings-card
          className={`${SETTINGS_SURFACE} px-4 py-3`}
        >
          <p className="text-xs mb-1 text-(--t-text-dim)">{t("settings.account.currentMode")}</p>
          <div className="flex items-center gap-2">
            <Icon icon={modeIcon} width={14} className="text-(--t-accent)" />
            <span className="text-sm font-medium text-(--t-text-primary)">{modeLabel}</span>
          </div>
        </div>
      </div>

      {mode === "server" && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
            {t("settings.account.handle.title")}
          </h3>
          <HandleCard me={me} />

          <div data-settings-card data-setting-row className={`mt-2 ${SETTINGS_SURFACE} px-4 py-3 flex items-center justify-between gap-4`}>
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.account.strangerInvites.label")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.account.strangerInvites.desc")}</p>
              {strangerInvitesError && <p className="text-xs mt-1 text-(--t-status-error)">{strangerInvitesError}</p>}
            </div>
            <Toggle
              checked={allowStrangerInvites}
              onChange={toggleStrangerInvites}
              disabled={strangerInvitesLoading}
              aria-label={t("settings.account.strangerInvites.label")}
            />
          </div>
        </div>
      )}

      {mode === "server" && <PlansSection />}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.account.sessionSecurity.title")}
        </h3>
        <SessionSecuritySettings mode={mode} />
      </div>

      {success && <p className="text-xs px-1 text-(--t-status-connected)">{success}</p>}
      {error && <p className="text-xs px-1 text-(--t-status-error)">{error}</p>}

      {step === "idle" && (
        <div className="space-y-2">
          {mode === "server" && currentEmail && (
            <ActionItem
              icon="lucide:mail"
              label={t("settings.account.email")}
              sub={currentEmail}
              onClick={() => setShowEditEmail(true)}
            />
          )}
          {mode === "server" && (
            <ActionItem
              icon="lucide:key-round"
              label={t("settings.account.changeMasterPassword.label")}
              sub={t("settings.account.changeMasterPassword.sub")}
              onClick={() => setShowChangePassword(true)}
            />
          )}
          {mode === "server" && <TwoFactorSettings enabled={twoFactorEnabled} onChange={setTwoFactorEnabled} />}
          {mode === "local-nopassword" && (
            <ActionItem
              icon="lucide:lock"
              label={t("settings.account.setMasterPassword.label")}
              sub={t("settings.account.setMasterPassword.sub")}
              onClick={() => {
                reset();
                setStep("set-password");
              }}
            />
          )}
          {lockable && (
            <ActionItem
              icon="lucide:lock"
              label={t("settings.account.lockVault.label")}
              sub={t("settings.account.lockVault.sub")}
              onClick={() => {
                setError("");
                lockApp().catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}
            />
          )}
          {mode === "server" && (
            <ActionItem
              icon="lucide:log-out"
              label={t("settings.account.signOut.label")}
              sub={t("settings.account.signOut.sub")}
              danger
              onClick={() => {
                setError("");
                requestSignOut();
              }}
            />
          )}
          {mode === "server" && (
            <ActionItem
              icon="lucide:user-x"
              label={t("shared.deleteAccount.action")}
              sub={t("shared.deleteAccount.actionSub")}
              danger
              onClick={() => {
                setError("");
                setShowDeleteAccount(true);
              }}
            />
          )}
          <ActionItem
            icon="lucide:trash-2"
            label={t("settings.account.wipeData.label")}
            sub={t("settings.account.wipeData.sub")}
            danger
            onClick={() => {
              reset();
              setStep("confirm-wipe");
            }}
          />
        </div>
      )}

      {step === "idle" && mode === "server" && <ActiveSessionsSettings />}

      {step === "idle" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-(--t-text-secondary)">
            {t("shared.vaultBackups.title")}
          </p>
          <VaultBackups currentReadable />
        </div>
      )}

      {signOutConfirm}

      {showDeleteAccount && (
        <DeleteAccountModal onCancel={() => setShowDeleteAccount(false)} onDeleted={() => window.location.reload()} />
      )}

      {showEditEmail && currentEmail && (
        <EditEmailModal
          currentEmail={currentEmail}
          onClose={() => {
            setShowEditEmail(false);
            getCurrentUserEmail().then(setCurrentEmail).catch(() => {});
          }}
        />
      )}

      {showChangePassword && (
        <ChangeMasterPasswordModal twoFactorEnabled={!!twoFactorEnabled} onClose={() => setShowChangePassword(false)} />
      )}

      {step === "confirm-wipe" && (
        <div className="space-y-3">
          <p className="text-xs text-(--t-text-muted)">
            <Trans i18nKey="settings.account.confirmWipe.desc" components={{ strong: <strong /> }} />
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 text-xs px-3 py-1.5 rounded-sm bg-(--t-bg-elevated) text-(--t-text-muted) hover:text-(--t-text-base) transition-colors"
              onClick={reset}
            >
              {t("settings.shared.cancel")}
            </button>
            <button
              className="flex-1 text-xs px-3 py-1.5 rounded-sm bg-(--t-status-error) text-white hover:opacity-80 transition-opacity font-medium"
              onClick={() => {
                setStep("loading");
                resetVault()
                  .then(() => window.location.reload())
                  .catch((e) => {
                    setError(e instanceof Error ? e.message : String(e));
                    setStep("idle");
                  });
              }}
            >
              {t("settings.account.confirmWipe.confirm")}
            </button>
          </div>
        </div>
      )}

      {step === "set-password" && (
        <form onSubmit={handleSetPassword} className="space-y-2">
          <p className="text-xs text-(--t-text-muted)">
            {t("settings.account.setPassword.desc")}
          </p>
          <SettingsInput
            type="password"
            placeholder={t("settings.account.setPassword.newPlaceholder")}
            value={password}
            onChange={setPassword}
            autoFocus
          />
          <SettingsInput
            type="password"
            placeholder={t("settings.account.setPassword.confirmPlaceholder")}
            value={confirm}
            onChange={setConfirm}
          />
          <FormButtons onCancel={reset} submitLabel={t("settings.account.setPassword.submit")} />
        </form>
      )}

      {step === "loading" && (
        <div className="flex items-center gap-2 px-1">
          <Icon icon="lucide:loader-circle" width={14} className="animate-spin text-(--t-accent)" />
          <span className="text-sm text-(--t-text-muted)">{t("settings.account.loading")}</span>
        </div>
      )}
    </div>
  );
}

// ─── Plans section ────────────────────────────────────────────────────────────

export function PlansSection() {
  const { t } = useTranslation();
  const plan = usePlanDisplay();
  const { ownsTeamsPlan, subscriptionStatus, subscriptionCancelled, renewsAt, endsAt } = useSubscriptionStore();
  const seatsText = seatsUsedText(t, useSeatReadout(), "settings.account.plan.seatsUsed");
  const platform = usePlatform();
  const previous = adjacentPlan(plan.plan, -1);
  const next = adjacentPlan(plan.plan, 1);
  const planName = (tier: string) => t(`settings.account.plan.name.${tier}`);

  const manageBilling = plan.showManageBilling && (
    <button
      onClick={() => openPortal()}
      className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
    >
      {t("settings.account.plan.manageBilling")}
    </button>
  );
  const badgeColor = plan.premium ? "#f59e0b" : "var(--t-text-muted)";
  const renewalDate = formatOptionalDate(renewsAt, SHORT_DATE);
  const cancellationDate = formatOptionalDate(endsAt ?? renewsAt, SHORT_DATE);

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
        {t("settings.account.plan.title")}
      </h3>

      <div data-settings-card className={`${SETTINGS_SURFACE} px-4 py-3 space-y-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon
              icon={plan.icon}
              width={14}
              style={{ color: badgeColor }}
            />
            <span data-plan-line className="text-sm font-medium text-(--t-text-primary)">{plan.line}</span>
          </div>
          {!plan.ownLine && <div className="flex items-center gap-2">{manageBilling}</div>}
        </div>

        {plan.ownLine && (
          <div className="flex items-center justify-between text-xs">
            <span data-plan-own-line className="text-(--t-text-secondary)">{plan.ownLine}</span>
            {manageBilling}
          </div>
        )}

        {plan.ownBilled && (
          <div className="rounded-md px-3 py-2 bg-(--t-bg-input) text-xs text-(--t-text-muted)">
            {subscriptionCancelled ? (
              <span>
                {cancellationDate
                  ? t("settings.account.plan.subscription.cancelled", { date: cancellationDate })
                  : t("settings.account.plan.subscription.cancelledNoPeriod")}
              </span>
            ) : subscriptionStatus === "active" && renewalDate ? (
              <span>{t("settings.account.plan.subscription.renews", { date: renewalDate })}</span>
            ) : (
              <span>{t("settings.account.plan.subscription.active")}</span>
            )}
          </div>
        )}

        {ownsTeamsPlan && seatsText && (
          <div className="flex items-center justify-between text-xs py-0.5">
            <span style={{ color: "var(--t-text-secondary)" }}>{t("settings.account.plan.seats")}</span>
            <span style={{ color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
              {seatsText}
            </span>
          </div>
        )}

        {plan.showUpgrade && (
          <UpgradeStrip
            label={t(plan.trialOffer ? "settings.account.plan.activateTrial" : "settings.account.plan.upgradeToPro")}
            buttonLabel={t(plan.trialOffer ? "settings.account.plan.activate" : "settings.account.plan.upgrade")}
            onClick={() => openCheckout("pro")}
          />
        )}

        {(plan.upgradeTo === "teams" || plan.teamsTrialOffer) && (
          <UpgradeStrip
            variant="neutral"
            label={plan.teamsTrialOffer
              ? t("settings.account.plan.upgradeToTeams", { days: TEAMS_TRIAL_DAYS })
              : t("settings.account.plan.upgradeToTeamsPlain")}
            buttonLabel={t(plan.teamsTrialOffer ? "settings.account.plan.teamsButton" : "settings.account.plan.upgrade")}
            onClick={() => openCheckout("teams")}
          />
        )}

        <div className="border-t border-(--t-border) pt-3 space-y-3">
          <PlanFeatureGroup
            heading={previous && t("settings.account.plan.everythingIn", { plan: planName(previous) })}
            features={planFeaturesFor(plan.plan, platform)}
            included
          />
          {next && (
            <PlanFeatureGroup
              heading={t("settings.account.plan.nextAdds", { plan: planName(next) })}
              features={planFeaturesFor(next, platform)}
              included={false}
            />
          )}
          {previous && <FreeFeaturesLine />}
        </div>

        {plan.showAllPlans && (
          <button
            onClick={() => openPortal()}
            className="text-xs w-full text-center text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors pt-1"
          >
            {t("settings.account.plan.viewAllPlans")}
          </button>
        )}
      </div>
    </div>
  );
}

function PlanFeatureGroup({ heading, features, included }: { heading: string | null; features: PlanFeature[]; included: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-plan-group={included ? "included" : "next"} className="space-y-1.5">
      {heading && <p className="text-xs font-medium text-(--t-text-secondary)">{heading}</p>}
      {features.map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: included ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
            {planFeatureLabel(t, f)}
          </span>
          <Icon
            icon={included ? "lucide:check" : "lucide:minus"}
            width={12}
            className="shrink-0"
            style={{ color: included ? "var(--t-status-connected)" : "var(--t-text-dim)" }}
          />
        </div>
      ))}
    </div>
  );
}
