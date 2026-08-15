import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getAccountMode, getCurrentUserEmail, getMe, updateDisplayName, setMasterPassword, logout, lockVaultSession } from "@/services/account";
import { resetVault } from "@/services/vault";
import { useSecurityStore } from "@/stores/securityStore";
import { ActionItem, FormButtons, SettingsInput } from "./shared";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { openPortal } from "@/utils/billing";
import { openBillingCheckout } from "@/services/billingCheckout";
import { claimHandle, updateInvitePreferences, HandleClaimError } from "@/services/teamService";
import { Toggle } from "@/components/shared/Toggle";
import { writeClipboard } from "@/utils/clipboard";
import EditEmailModal from "./EditEmailModal";
import ChangeMasterPasswordModal from "./ChangeMasterPasswordModal";

type AccountStep = "idle" | "set-password" | "loading" | "confirm-wipe";

/**
 * Shared idle → editing → submitting → error cycle behind both the display-name
 * row and the handle-claim row below — same shape, different save/validate fns.
 */
function useEditableField(
  save: (value: string) => Promise<void>,
  onSaved: (value: string) => void,
) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const start = (initial: string) => {
    setInput(initial);
    setError("");
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError("");
  };
  const submit = async (validate?: (value: string) => string | null) => {
    const trimmed = input.trim();
    const validationError = validate?.(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await save(trimmed);
      onSaved(trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return { editing, input, setInput, error, loading, start, cancel, submit };
}

const PLAN_FEATURES = [
  { id: "localVault",       free: true,  pro: true,  teams: true,  business: true  },
  { id: "auditLogs",        free: true,  pro: true,  teams: true,  business: true  },
  { id: "gistSync",         free: true,  pro: true,  teams: true,  business: true  },
  { id: "realtimeSync",     free: false, pro: true,  teams: true,  business: true  },
  { id: "unlimitedVaults",  free: false, pro: true,  teams: true,  business: true  },
  { id: "terminalSharing",  free: false, pro: true,  teams: true,  business: true  },
  { id: "teamVaults",       free: false, pro: false, teams: true,  business: true  },
  { id: "teamSharing",      free: false, pro: false, teams: true,  business: true  },
  { id: "customRoles",      free: false, pro: false, teams: false, business: true  },
];

async function openCheckout(plan: "pro" | "teams") {
  await openBillingCheckout(plan);
}

/** Maps claimHandle's status-carrying error to the copy the server's per-status
 *  contract calls for — each status needs a distinct next step, not one generic message. */
function mapHandleClaimError(e: unknown, t: (key: string) => string): Error {
  if (e instanceof HandleClaimError) {
    const key =
      e.status === 402 ? "settings.account.handle.errorTierRequired" :
      e.status === 409 ? "settings.account.handle.errorTaken" :
      e.status === 422 ? "settings.account.handle.errorInvalid" :
      e.status === 429 ? "settings.account.handle.errorCooldown" :
      "settings.account.handle.errorGeneric";
    return new Error(t(key));
  }
  return e instanceof Error ? e : new Error(String(e));
}

export default function AccountSection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<string | null>(null);
  const [step, setStep] = useState<AccountStep>("idle");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showEditEmail, setShowEditEmail] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [handle, setHandle] = useState<string | null>(null);
  const [handleIsCustom, setHandleIsCustom] = useState(false);
  const [meTier, setMeTier] = useState<string | undefined>(undefined);
  const [handleCopied, setHandleCopied] = useState(false);
  const [allowStrangerInvites, setAllowStrangerInvites] = useState(true);
  const [strangerInvitesError, setStrangerInvitesError] = useState("");
  const sessionTimeoutMinutes = useSecurityStore((s) => s.sessionTimeoutMinutes);
  const setSessionTimeoutMinutes = useSecurityStore((s) => s.setSessionTimeoutMinutes);

  const displayNameField = useEditableField(
    (value) => updateDisplayName(value),
    (value) => setDisplayName(value),
  );
  const handleField = useEditableField(
    async (value) => {
      try {
        await claimHandle(value);
      } catch (e) {
        throw mapHandleClaimError(e, t);
      }
    },
    (value) => { setHandle(value); setHandleIsCustom(true); },
  );
  const isFreeTier = !meTier || meTier === "free";

  const handleCopyHandle = () => {
    if (!handle) return;
    writeClipboard(`@${handle}`).then(() => {
      setHandleCopied(true);
      setTimeout(() => setHandleCopied(false), 1500);
    }).catch(() => {});
  };

  const toggleStrangerInvites = async (next: boolean) => {
    setAllowStrangerInvites(next);
    setStrangerInvitesError("");
    try {
      await updateInvitePreferences(next);
    } catch (e) {
      setAllowStrangerInvites(!next); // revert — the toggle can't silently drift from the server's stored value
      setStrangerInvitesError(e instanceof Error ? e.message : String(e));
    }
  };

  const SESSION_TIMEOUT_OPTIONS = [
    { label: t("settings.account.sessionSecurity.timeout.never"), value: "never" },
    { label: t("settings.account.sessionSecurity.timeout.5min"),  value: "5" },
    { label: t("settings.account.sessionSecurity.timeout.15min"), value: "15" },
    { label: t("settings.account.sessionSecurity.timeout.30min"), value: "30" },
    { label: t("settings.account.sessionSecurity.timeout.1h"),    value: "60" },
    { label: t("settings.account.sessionSecurity.timeout.4h"),    value: "240" },
  ];

  useEffect(() => {
    getAccountMode().then(setMode).catch(() => setMode(null));
    getCurrentUserEmail().then(setCurrentEmail).catch(() => {});
    getMe().then((me) => {
      if (!me) return;
      if (me.display_name) setDisplayName(me.display_name);
      if (me.handle) setHandle(me.handle);
      setHandleIsCustom(!!me.handle_is_custom);
      setMeTier(me.tier);
      if (typeof me.allow_stranger_invites === "boolean") setAllowStrangerInvites(me.allow_stranger_invites);
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

  const canLockVault = mode === "local" || mode === "server";
  const timeoutSelectValue = sessionTimeoutMinutes === null ? "never" : String(sessionTimeoutMinutes);

  return (
    <div className="p-6 max-w-lg space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.account.modeTitle")}
        </h3>
        <div
          className="rounded-lg px-4 py-3 bg-(--t-bg-elevated) border border-(--t-border)"
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
          <div className="rounded-lg px-4 py-3 space-y-2 bg-(--t-bg-elevated) border border-(--t-border)">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-(--t-text-primary)">
                {handle ? `@${handle}` : "—"}
              </span>
              <button
                type="button"
                onClick={handleCopyHandle}
                className="text-xs px-2 py-1 rounded-md flex items-center gap-1 text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
              >
                <Icon icon={handleCopied ? "lucide:check" : "lucide:copy"} width={12} />
                {handleCopied ? t("settings.account.handle.copied") : t("settings.account.handle.copy")}
              </button>
            </div>

            {isFreeTier ? (
              <div className="space-y-1">
                <p className="text-xs text-(--t-text-dim)">{t("settings.account.handle.upsell")}</p>
                <p className="text-xs text-(--t-text-muted)">{t("settings.account.handle.reachableNote")}</p>
              </div>
            ) : handleField.editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleField.submit((value) => (value ? null : t("settings.account.handle.errorInvalid")));
                }}
                className="space-y-2"
              >
                <SettingsInput
                  placeholder={t("settings.account.handle.placeholder")}
                  value={handleField.input}
                  onChange={handleField.setInput}
                  autoFocus
                  aria-label={t("settings.account.handle.inputLabel")}
                />
                {handleField.error && <p className="text-xs text-(--t-status-error)">{handleField.error}</p>}
                <FormButtons
                  onCancel={handleField.cancel}
                  submitLabel={t("settings.account.handle.save")}
                  submitting={handleField.loading}
                />
              </form>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => handleField.start(handleIsCustom ? (handle ?? "") : "")}
                  className="text-xs px-2.5 py-1 rounded-md font-medium bg-(--t-accent) text-white hover:opacity-85 transition-opacity"
                >
                  {handleIsCustom ? t("settings.account.handle.change") : t("settings.account.handle.choose")}
                </button>
                <p className="text-xs mt-1.5 text-(--t-text-dim)">{t("settings.account.handle.chooseSub")}</p>
              </div>
            )}
          </div>

          <div className="mt-2 rounded-lg px-4 py-3 flex items-center justify-between gap-4 bg-(--t-bg-elevated) border border-(--t-border)">
            <div>
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.account.strangerInvites.label")}</p>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.account.strangerInvites.desc")}</p>
              {strangerInvitesError && <p className="text-xs mt-1 text-(--t-status-error)">{strangerInvitesError}</p>}
            </div>
            <Toggle
              checked={allowStrangerInvites}
              onChange={toggleStrangerInvites}
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
        {canLockVault ? (
          <div
            className="rounded-lg px-4 py-3 space-y-2 bg-(--t-bg-elevated) border border-(--t-border)"
          >
            <label className="text-xs text-(--t-text-dim)">
              {t("settings.account.sessionSecurity.autoLockLabel")}
            </label>
            <select
              value={timeoutSelectValue}
              onChange={(e) => {
                const next = e.target.value === "never" ? null : Number(e.target.value);
                setSessionTimeoutMinutes(Number.isFinite(next) ? next : null);
              }}
              className="w-full rounded-lg px-3 py-2 text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
            >
              {SESSION_TIMEOUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-(--t-text-dim)">
              {t("settings.account.sessionSecurity.autoLockDesc")}
            </p>
          </div>
        ) : (
          <p className="text-xs text-(--t-text-muted)">
            {t("settings.account.sessionSecurity.noPasswordHint")}
          </p>
        )}
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
            displayNameField.editing ? (
              <div
                className="flex flex-col gap-2 rounded-lg px-4 py-3"
                style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
              >
                <p className="text-xs font-medium text-(--t-text-dim)">{t("settings.account.displayName.title")}</p>
                <input
                  autoFocus
                  type="text"
                  value={displayNameField.input}
                  maxLength={50}
                  onChange={(e) => displayNameField.setInput(e.target.value)}
                  className="rounded-lg px-3 py-1.5 text-sm outline-hidden"
                  style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
                />
                {displayNameField.error && <p className="text-xs text-(--t-status-error)">{displayNameField.error}</p>}
                <div className="flex gap-2">
                  <button
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "var(--t-bg-input)", color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}
                    onClick={displayNameField.cancel}
                  >
                    {t("settings.shared.cancel")}
                  </button>
                  <button
                    disabled={displayNameField.loading}
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    style={{ background: "var(--t-accent)", color: "#fff" }}
                    onClick={() => displayNameField.submit(
                      (value) => (value ? null : t("settings.account.displayName.cannotBeEmpty")),
                    )}
                  >
                    {displayNameField.loading ? t("settings.account.displayName.saving") : t("settings.account.displayName.save")}
                  </button>
                </div>
              </div>
            ) : (
              <ActionItem
                icon="lucide:user"
                label={t("settings.account.displayName.title")}
                sub={displayName ?? "—"}
                onClick={() => displayNameField.start(displayName ?? "")}
              />
            )
          )}
          {mode === "server" && (
            <ActionItem
              icon="lucide:key-round"
              label={t("settings.account.changeMasterPassword.label")}
              sub={t("settings.account.changeMasterPassword.sub")}
              onClick={() => setShowChangePassword(true)}
            />
          )}
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
          {canLockVault && (
            <ActionItem
              icon="lucide:lock"
              label={t("settings.account.lockVault.label")}
              sub={t("settings.account.lockVault.sub")}
              onClick={() => {
                setError("");
                lockVaultSession()
                  .then(() => window.location.reload())
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
                logout()
                  .then(() => window.location.reload())
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
        <ChangeMasterPasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      {step === "confirm-wipe" && (
        <div className="space-y-3">
          <p className="text-xs text-(--t-text-muted)">
            {t("settings.account.confirmWipe.descPre")}
            <strong>{t("settings.account.confirmWipe.descBold")}</strong>
            {t("settings.account.confirmWipe.descPost")}
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

function formatPlanDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function PlansSection() {
  const { t } = useTranslation();
  const { tier, trialEndsAt, isTrialActive, isPro, isTeams, isBusiness, usedSeats, totalSeats, subscriptionStatus, subscriptionCancelled, renewsAt, endsAt } = useSubscriptionStore();

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : 0;

  const badgeLabel =
    isBusiness ? t("settings.account.plan.badge.business") :
    isTeams ? t("settings.account.plan.badge.teams") :
    isTrialActive ? t("settings.account.plan.badge.proTrial", { daysLeft }) :
    tier === "pro" ? t("settings.account.plan.badge.pro") : t("settings.account.plan.badge.free");

  const isPaidPro = isPro && !isTrialActive;

  const badgeColor = isPro ? "#f59e0b" : "var(--t-text-muted)";
  const renewalDate = formatPlanDate(renewsAt);
  const cancellationDate = formatPlanDate(endsAt ?? renewsAt);

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
        {t("settings.account.plan.title")}
      </h3>

      <div className="rounded-lg px-4 py-3 bg-(--t-bg-elevated) border border-(--t-border) space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon
              icon={isPro ? "lucide:crown" : "lucide:circle-fading-arrow-up"}
              width={14}
              style={{ color: badgeColor }}
            />
            <span className="text-sm font-medium text-(--t-text-primary)">{badgeLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {isPaidPro && (
              <button
                onClick={() => openPortal()}
                className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
              >
                {t("settings.account.plan.manageBilling")}
              </button>
            )}
          </div>
        </div>

        {isPaidPro && (
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

        {isTeams && totalSeats != null && (
          <div className="flex items-center justify-between text-xs py-0.5">
            <span style={{ color: "var(--t-text-secondary)" }}>{t("settings.account.plan.seats")}</span>
            <span style={{ color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
              {t("settings.account.plan.seatsUsed", { used: usedSeats ?? "…", total: totalSeats })}
            </span>
          </div>
        )}

        {!isPro && (
          <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 bg-(--t-bg-input)">
            <p className="text-xs text-(--t-text-muted)">{t("settings.account.plan.upgradeToPro")}</p>
            <button
              onClick={() => openCheckout("pro")}
              className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0 bg-(--t-accent) text-white hover:opacity-85 transition-opacity"
            >
              {t("settings.account.plan.upgrade")}
            </button>
          </div>
        )}

        {isPro && !isTeams && (
          <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 bg-(--t-bg-input)">
            <p className="text-xs text-(--t-text-muted)">{t("settings.account.plan.upgradeToTeams")}</p>
            <button
              onClick={() => openCheckout("teams")}
              className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0 bg-(--t-bg-elevated) text-(--t-text-primary) hover:opacity-85 transition-opacity border border-(--t-border)"
            >
              {t("settings.account.plan.teamsButton")}
            </button>
          </div>
        )}

        {/* Feature comparison */}
        <div className="border-t border-(--t-border) pt-3 space-y-1.5">
          {PLAN_FEATURES.map(({ id, free, pro, teams: teamsFlag, business }) => {
            const active = isBusiness ? business : isTeams ? teamsFlag : isPro ? pro : free;
            return (
              <div key={id} className="flex items-center justify-between">
                <span className="text-xs" style={{ color: active ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
                  {t(`settings.account.plan.feature.${id}`)}
                </span>
                <Icon
                  icon={active ? "lucide:check" : "lucide:minus"}
                  width={12}
                  style={{ color: active ? "var(--t-status-connected)" : "var(--t-text-dim)" }}
                />
              </div>
            );
          })}
        </div>

        <button
          onClick={() => openPortal()}
          className="text-xs w-full text-center text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors pt-1"
        >
          {t("settings.account.plan.viewAllPlans")}
        </button>
      </div>
    </div>
  );
}
