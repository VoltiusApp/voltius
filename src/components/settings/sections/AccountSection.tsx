import { useEffect, useState, type FormEvent } from "react";
import { Toggle } from "@/components/shared/Toggle";
import { Icon } from "@iconify/react";
import { getAccountMode, getCurrentUserEmail, fetchAndCacheDisplayName, updateDisplayName, setMasterPassword, linkToCloud, signInToCloud, logout, lockVaultSession } from "@/services/account";
import { resetVault } from "@/services/vault";
import { syncOnLogin, syncOnLoginReplace, startRealtimeSync, getSyncState, onSyncStateChange, syncNow } from "@/services/sync";
import { useSecurityStore } from "@/stores/securityStore";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";
import { ActionItem, FormButtons, SettingsInput } from "./shared";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { openPortal } from "@/utils/billing";
import { openBillingCheckout } from "@/services/billingCheckout";
import EditEmailModal from "./EditEmailModal";
import ChangeMasterPasswordModal from "./ChangeMasterPasswordModal";

type AccountStep = "idle" | "set-password" | "link-cloud" | "loading" | "confirm-wipe";
type CloudAction = "register" | "signin";

const DEFAULT_SERVER = "https://api.voltius.app";

const SESSION_TIMEOUT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Never", value: "never" },
  { label: "5 minutes", value: "5" },
  { label: "15 minutes", value: "15" },
  { label: "30 minutes", value: "30" },
  { label: "1 hour", value: "60" },
  { label: "4 hours", value: "240" },
];

async function openCheckout(plan: "pro" | "teams") {
  await openBillingCheckout(plan);
}

export default function AccountSection() {
  const [mode, setMode] = useState<string | null>(null);
  const [step, setStep] = useState<AccountStep>("idle");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [displayNameError, setDisplayNameError] = useState("");
  const [displayNameLoading, setDisplayNameLoading] = useState(false);
  const [linkPassword, setLinkPassword] = useState("");
  const [linkConfirm, setLinkConfirm] = useState("");
  const [cloudAction, setCloudAction] = useState<CloudAction>("signin");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [showServerUrl, setShowServerUrl] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showEditEmail, setShowEditEmail] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [syncState, setSyncState] = useState(getSyncState);
  const sessionTimeoutMinutes = useSecurityStore((s) => s.sessionTimeoutMinutes);
  const setSessionTimeoutMinutes = useSecurityStore((s) => s.setSessionTimeoutMinutes);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const { syncTypes, setSyncType } = useSyncPrefsStore();

  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);

  useEffect(() => {
    getAccountMode().then(setMode).catch(() => setMode(null));
    getCurrentUserEmail().then(setCurrentEmail).catch(() => {});
    fetchAndCacheDisplayName().then((n) => { if (n) setDisplayName(n); }).catch(() => {});
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
    setLinkPassword("");
    setLinkConfirm("");
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
      setError("At least 4 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    await wrap(() => setMasterPassword(password), "Master password set. Your vault is now password-protected.");
    setPassword("");
    setConfirm("");
  };

  const handleLinkCloud = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Invalid email");
      return;
    }

    if (cloudAction === "signin") {
      if (linkPassword.length < 1) {
        setError("Password required");
        return;
      }
      await wrap(async () => {
        await signInToCloud(email, linkPassword, serverUrl);
      }, "Signed in. Sync is now active.");
      // Existing cloud account: use replace-mode sync — never reads local disk,
      // merges only remote blobs → guaranteed no local contamination.
      syncOnLoginReplace().catch(() => {});
      startRealtimeSync();
    } else {
      // New cloud account: push local data to cloud (merge-mode sync)
      const afterRegister = () => {
        syncOnLogin().catch(() => {});
        startRealtimeSync();
      };
      if (mode === "local-nopassword") {
        if (linkPassword.length < 4) {
          setError("At least 4 characters");
          return;
        }
        if (linkPassword !== linkConfirm) {
          setError("Passwords don't match");
          return;
        }
        await wrap(async () => {
          await setMasterPassword(linkPassword);
          await linkToCloud(email, serverUrl);
        }, "Account created. Sync is now active.");
        afterRegister();
      } else {
        await wrap(async () => {
          await linkToCloud(email, serverUrl);
        }, "Account created. Sync is now active.");
        afterRegister();
      }
    }
  };

  const modeLabel =
    mode === "local-nopassword" ? "Local (OS keychain)" :
    mode === "local" ? "Local (master password)" :
    mode === "server" ? "Cloud account" : "Unknown";

  const modeIcon =
    mode === "local-nopassword" ? "lucide:key-round" :
    mode === "local" ? "lucide:lock" : "lucide:cloud";

  const canLockVault = mode === "local" || mode === "server";
  const timeoutSelectValue = sessionTimeoutMinutes === null ? "never" : String(sessionTimeoutMinutes);

  return (
    <div className="p-6 max-w-lg space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Account Mode
        </h3>
        <div
          className="rounded-lg px-4 py-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
        >
          <p className="text-xs mb-1 text-[var(--t-text-dim)]">Current mode</p>
          <div className="flex items-center gap-2">
            <Icon icon={modeIcon} width={14} className="text-[var(--t-accent)]" />
            <span className="text-sm font-medium text-[var(--t-text-primary)]">{modeLabel}</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Sync
        </h3>
        <div
          className="rounded-lg px-4 py-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
        >
          {mode === "server" ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">Cloud sync active</p>
                <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                  {syncState.status === "syncing" && "Syncing..."}
                  {syncState.status === "error" && `Error: ${syncState.error ?? "unknown"}`}
                  {syncState.status === "success" && syncState.lastSync && `Last sync: ${syncState.lastSync.toLocaleTimeString()}`}
                  {syncState.status === "offline" && "Offline"}
                  {syncState.status === "idle" && "Not synced yet"}
                </p>
              </div>
              <button
                onClick={() => {
                  if (syncState.status !== "syncing") syncNow().catch(() => {});
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors shrink-0 bg-[var(--t-bg-input)]"
                style={{
                  color: syncState.status === "error" ? "var(--t-status-error)" : "var(--t-text-muted)",
                  opacity: syncState.status === "syncing" ? 0.5 : 1,
                }}
                disabled={syncState.status === "syncing"}
              >
                <Icon
                  icon="lucide:refresh-cw"
                  width={18}
                  className={syncState.status === "syncing" ? "animate-spin" : ""}
                />
                Sync now
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">Cloud account not connected</p>
                <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">
                  Sign in or create a cloud account to sync across devices and use subscription features.
                </p>
              </div>
              {(mode === "local" || mode === "local-nopassword" || mode === null) && step === "idle" && (
                <button
                  type="button"
                  onClick={() => {
                    openCloudAuth("signin");
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 bg-[var(--t-bg-input)] text-[var(--t-text-primary)]"
                >
                  Sign in / Create
                </button>
              )}
            </div>
          )}
        </div>

        {step === "link-cloud" && (
          <form onSubmit={handleLinkCloud} className="mt-3 space-y-3">
            <div className="flex rounded-lg overflow-hidden border border-[var(--t-border)]">
              {(["signin", "register"] as CloudAction[]).map((action) => {
                const active = cloudAction === action;
                return (
                  <button
                    key={action}
                    type="button"
                    onClick={() => {
                      setCloudAction(action);
                      setError("");
                    }}
                    className="flex-1 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: active ? "var(--t-accent)" : "var(--t-bg-elevated)",
                      color: active ? "#fff" : "var(--t-text-muted)",
                    }}
                  >
                    {action === "signin" ? "Sign in" : "Create account"}
                  </button>
                );
              })}
            </div>

            <SettingsInput type="email" placeholder="Email" value={email} onChange={setEmail} autoFocus />

            {cloudAction === "signin" && (
              <SettingsInput type="password" placeholder="Password" value={linkPassword} onChange={setLinkPassword} />
            )}
            {cloudAction === "register" && mode === "local-nopassword" && (
              <>
                <SettingsInput
                  type="password"
                  placeholder="Create a password"
                  value={linkPassword}
                  onChange={setLinkPassword}
                />
                <SettingsInput
                  type="password"
                  placeholder="Confirm password"
                  value={linkConfirm}
                  onChange={setLinkConfirm}
                />
              </>
            )}

            <button
              type="button"
              onClick={() => setShowServerUrl((v) => !v)}
              className="text-xs w-full text-left transition-colors text-[var(--t-text-dim)]"
            >
              {showServerUrl ? "▾" : "▸"} Custom server URL
            </button>
            {showServerUrl && (
              <SettingsInput
                type="url"
                placeholder="https://api.voltius.app"
                value={serverUrl}
                onChange={setServerUrl}
              />
            )}
            <FormButtons onCancel={reset} submitLabel={cloudAction === "signin" ? "Sign in" : "Create account"} />
          </form>
        )}
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Sync Preferences
        </h3>
        <div
          className="rounded-lg divide-y bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
        >
          {SYNC_OBJECT_TYPES.map(({ id, label, sub }, i) => {
            const value = syncTypes[id] ?? true;
            return (
              <div
                key={id}
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={i > 0 ? { borderTop: "1px solid var(--t-border)" } : undefined}
              >
                <div>
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">{label}</p>
                  <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">{sub}</p>
                </div>
                <Toggle checked={value} onChange={(v) => setSyncType(id, v)} />
              </div>
            );
          })}
        </div>
        <p className="text-xs mt-2 px-1 text-[var(--t-text-muted)]">
          Disabled types won't trigger automatic syncs when changed. Individual objects can also be excluded via their edit panel.
        </p>
      </div>

      {mode === "server" && <PlansSection />}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
          Session Security
        </h3>
        {canLockVault ? (
          <div
            className="rounded-lg px-4 py-3 space-y-2 bg-[var(--t-bg-elevated)] border border-[var(--t-border)]"
          >
            <label className="text-xs text-[var(--t-text-dim)]">
              Auto-lock vault after inactivity
            </label>
            <select
              value={timeoutSelectValue}
              onChange={(e) => {
                const next = e.target.value === "never" ? null : Number(e.target.value);
                setSessionTimeoutMinutes(Number.isFinite(next) ? next : null);
              }}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
            >
              {SESSION_TIMEOUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--t-text-dim)]">
              Locks your vault and asks for your master password when your session expires.
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--t-text-muted)]">
            Enable a master password to use auto-lock and session timeout.
          </p>
        )}
      </div>

      {success && <p className="text-xs px-1 text-[var(--t-status-connected)]">{success}</p>}
      {error && <p className="text-xs px-1 text-[var(--t-status-error)]">{error}</p>}

      {step === "idle" && (
        <div className="space-y-2">
          {mode === "server" && currentEmail && (
            <ActionItem
              icon="lucide:mail"
              label="Email"
              sub={currentEmail}
              onClick={() => setShowEditEmail(true)}
            />
          )}
          {mode === "server" && (
            editingDisplayName ? (
              <div
                className="flex flex-col gap-2 rounded-lg px-4 py-3"
                style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
              >
                <p className="text-xs font-medium text-[var(--t-text-dim)]">Display name</p>
                <input
                  autoFocus
                  type="text"
                  value={displayNameInput}
                  maxLength={50}
                  onChange={(e) => { setDisplayNameInput(e.target.value); setDisplayNameError(""); }}
                  className="rounded-lg px-3 py-1.5 text-sm outline-none"
                  style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
                />
                {displayNameError && <p className="text-xs text-[var(--t-status-error)]">{displayNameError}</p>}
                <div className="flex gap-2">
                  <button
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "var(--t-bg-input)", color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}
                    onClick={() => { setEditingDisplayName(false); setDisplayNameError(""); }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={displayNameLoading}
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    style={{ background: "var(--t-accent)", color: "#fff" }}
                    onClick={async () => {
                      const trimmed = displayNameInput.trim();
                      if (!trimmed) { setDisplayNameError("Cannot be empty"); return; }
                      setDisplayNameLoading(true);
                      setDisplayNameError("");
                      try {
                        await updateDisplayName(trimmed);
                        setDisplayName(trimmed);
                        setEditingDisplayName(false);
                      } catch (e) {
                        setDisplayNameError(e instanceof Error ? e.message : "Update failed");
                      } finally {
                        setDisplayNameLoading(false);
                      }
                    }}
                  >
                    {displayNameLoading ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <ActionItem
                icon="lucide:user"
                label="Display name"
                sub={displayName ?? "—"}
                onClick={() => {
                  setDisplayNameInput(displayName ?? "");
                  setDisplayNameError("");
                  setEditingDisplayName(true);
                }}
              />
            )
          )}
          {mode === "server" && (
            <ActionItem
              icon="lucide:key-round"
              label="Change master password"
              sub="Update your password without re-encrypting your vault"
              onClick={() => setShowChangePassword(true)}
            />
          )}
          {mode === "local-nopassword" && (
            <ActionItem
              icon="lucide:lock"
              label="Set a master password"
              sub="Protect your vault locally without cloud sync"
              onClick={() => {
                reset();
                setStep("set-password");
              }}
            />
          )}
          {canLockVault && (
            <ActionItem
              icon="lucide:lock"
              label="Lock vault"
              sub="Lock now and require your master password"
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
              label="Sign out of cloud account"
              sub="Clears cached password and sync tokens"
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
            label="Wipe all local data"
            sub="Permanently deletes all connections, keys, vault, and keychain entries"
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
          <p className="text-xs text-[var(--t-text-muted)]">
            This will permanently delete <strong>all local data</strong>: connections, SSH keys, identities, vault secrets, and OS keychain entries. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 text-xs px-3 py-1.5 rounded bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)] hover:text-[var(--t-text-base)] transition-colors"
              onClick={reset}
            >
              Cancel
            </button>
            <button
              className="flex-1 text-xs px-3 py-1.5 rounded bg-[var(--t-status-error)] text-white hover:opacity-80 transition-opacity font-medium"
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
              Wipe everything
            </button>
          </div>
        </div>
      )}

      {step === "set-password" && (
        <form onSubmit={handleSetPassword} className="space-y-2">
          <p className="text-xs text-[var(--t-text-muted)]">
            Choose a master password. Your existing data will be re-encrypted.
          </p>
          <SettingsInput
            type="password"
            placeholder="New master password"
            value={password}
            onChange={setPassword}
            autoFocus
          />
          <SettingsInput type="password" placeholder="Confirm password" value={confirm} onChange={setConfirm} />
          <FormButtons onCancel={reset} submitLabel="Set password" />
        </form>
      )}

      {step === "loading" && (
        <div className="flex items-center gap-2 px-1">
          <Icon icon="lucide:loader-2" width={14} className="animate-spin text-[var(--t-accent)]" />
          <span className="text-sm text-[var(--t-text-muted)]">Working...</span>
        </div>
      )}
    </div>
  );
}

// ─── Plans section ────────────────────────────────────────────────────────────

const PLAN_FEATURES = [
  { label: "Local vault", free: true, pro: true, teams: true, business: true },
  { label: "Audit logs", free: true, pro: true, teams: true, business: true },
  { label: "GitHub Gist sync", free: true, pro: true, teams: true, business: true },
  { label: "Real-time cloud sync", free: false, pro: true, teams: true, business: true },
  { label: "Unlimited private vaults", free: false, pro: true, teams: true, business: true },
  { label: "Terminal sharing (1 session · 1 guest)", free: false, pro: true, teams: true, business: true },
  { label: "Shared team vaults", free: false, pro: false, teams: true, business: true },
  { label: "Team sharing (5 sessions · 10 guests)", free: false, pro: false, teams: true, business: true },
  { label: "Custom roles", free: false, pro: false, teams: false, business: true },
];

function formatPlanDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function PlansSection() {
  const { tier, trialEndsAt, isTrialActive, isPro, isTeams, isBusiness, usedSeats, totalSeats, subscriptionStatus, subscriptionCancelled, renewsAt, endsAt } = useSubscriptionStore();

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : 0;

  const badgeLabel =
    isBusiness ? "Business" :
    isTeams ? "Teams" :
    isTrialActive ? `Pro Trial — ${daysLeft}d left` :
    tier === "pro" ? "Pro" : "Free";

  const isPaidPro = isPro && !isTrialActive; // on a real subscription (not trial)

  const badgeColor = isPro ? "#f59e0b" : "var(--t-text-muted)";
  const renewalDate = formatPlanDate(renewsAt);
  const cancellationDate = formatPlanDate(endsAt ?? renewsAt);

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">
        Plan
      </h3>

      <div className="rounded-lg px-4 py-3 bg-[var(--t-bg-elevated)] border border-[var(--t-border)] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon
              icon={isPro ? "lucide:crown" : "lucide:circle-fading-arrow-up"}
              width={14}
              style={{ color: badgeColor }}
            />
            <span className="text-sm font-medium text-[var(--t-text-primary)]">{badgeLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {isPaidPro && (
              <button
                onClick={() => openPortal()}
                className="text-xs text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors"
              >
                Manage billing →
              </button>
            )}
          </div>
        </div>

        {isPaidPro && (
          <div className="rounded-md px-3 py-2 bg-[var(--t-bg-input)] text-xs text-[var(--t-text-muted)]">
            {subscriptionCancelled ? (
              <span>Cancels on {cancellationDate ?? "the period end"}. You keep access until then.</span>
            ) : subscriptionStatus === "active" && renewalDate ? (
              <span>Renews on {renewalDate}.</span>
            ) : (
              <span>Your subscription is active.</span>
            )}
          </div>
        )}

        {isTeams && totalSeats != null && (
          <div className="flex items-center justify-between text-xs py-0.5">
            <span style={{ color: "var(--t-text-secondary)" }}>Seats</span>
            <span style={{ color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
              {usedSeats ?? "…"} / {totalSeats} used
            </span>
          </div>
        )}

        {!isPro && (
          <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 bg-[var(--t-bg-input)]">
            <p className="text-xs text-[var(--t-text-muted)]">Upgrade to unlock cloud sync and more</p>
            <button
              onClick={() => openCheckout("pro")}
              className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0 bg-[var(--t-accent)] text-white hover:opacity-85 transition-opacity"
            >
              Upgrade
            </button>
          </div>
        )}

        {isPro && !isTeams && (
          <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 bg-[var(--t-bg-input)]">
            <p className="text-xs text-[var(--t-text-muted)]">Upgrade to Teams for shared vaults and unlimited guests</p>
            <button
              onClick={() => openCheckout("teams")}
              className="text-xs px-2.5 py-1 rounded-md font-medium shrink-0 bg-[var(--t-bg-elevated)] text-[var(--t-text-primary)] hover:opacity-85 transition-opacity border border-[var(--t-border)]"
            >
              Teams →
            </button>
          </div>
        )}

        {/* Feature comparison */}
        <div className="border-t border-[var(--t-border)] pt-3 space-y-1.5">
          {PLAN_FEATURES.map(({ label, free, pro, teams: t, business }) => {
            const active = isBusiness ? business : isTeams ? t : isPro ? pro : free;
            return (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs" style={{ color: active ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
                  {label}
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
          className="text-xs w-full text-center text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors pt-1"
        >
          View all plans →
        </button>
      </div>
    </div>
  );
}
