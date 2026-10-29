import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useUIStore, type CloudAuthMode } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import {
  authenticateServerAccount, getAccountMode, getCurrentUserEmail, linkToCloud, login, setMasterPassword, signInToCloud,
} from "@/services/account";
import { addAccount } from "@/services/savedAccounts";
import { syncNow, syncOnLogin, syncOnLoginReplace } from "@/services/sync";
import { startSessionSync } from "@/services/lanSync";
import { ServerUrlField } from "@/components/shared/ServerUrlField";
import { TwoFactorStep, useTwoFactorChallenge } from "@/components/shared/TwoFactorStep";
import { lastServerUrl } from "@/utils/serverInstance";

const AUTH_INPUT_CLASS =
  "w-full px-3 py-2.5 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) placeholder:text-(--t-text-muted) focus:border-(--t-accent)";

export default function CloudAuthModal() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.cloudAuthOpen);
  const purpose = useUIStore((s) => s.cloudAuthPurpose);
  const isAdd = purpose === "add";
  // The session this device held was ended by the server; the account itself is unchanged.
  const isReauth = purpose === "reauth";
  const mode = useUIStore((s) => (s.cloudAuthPurpose === "reauth" ? "signin" : s.cloudAuthMode));
  const setMode = useUIStore((s) => s.setCloudAuthMode);
  const onClose = useUIStore((s) => s.closeCloudAuth);
  const reloadSubscription = useSubscriptionStore((s) => s.load);

  const [accountMode, setAccountMode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [serverUrl, setServerUrl] = useState(lastServerUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const twoFactor = useTwoFactorChallenge();

  useEffect(() => {
    if (!open) return;
    getAccountMode().then(setAccountMode).catch(() => setAccountMode(null));
    if (isReauth) getCurrentUserEmail().then((current) => setEmail(current ?? "")).catch(() => {});
    setError("");
    twoFactor.cancel();
  }, [open, isReauth]);

  if (!open) return null;

  const isRegister = mode === "register";
  const isLocalNoPassword = accountMode === "local-nopassword";
  // Adding creates an account from nothing, so it needs a password of its own.
  const needsNewPassword = isRegister && (isAdd || isLocalNoPassword);
  const [minLength, minLengthError] = isAdd
    ? [8, "layout.auth.errorMinLength8"]
    : [4, "layout.cloudAuthModal.errorMinLength4"];

  const switchMode = (next: CloudAuthMode) => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) { setError(t("layout.auth.errorInvalidEmail")); return; }
    const normalizedUrl = serverUrl.replace(/\/+$/, "");

    if (!isRegister && password.length < 1) { setError(t("layout.cloudAuthModal.errorPasswordRequired")); return; }
    if (needsNewPassword) {
      if (password.length < minLength) { setError(t(minLengthError)); return; }
      if (password !== confirm) { setError(t("layout.auth.errorPasswordMismatch")); return; }
    }

    const connected = async (firstSync: () => Promise<void>) => {
      startSessionSync(firstSync().catch(() => {}));
      await reloadSubscription().catch(() => {});
      onClose();
      setEmail("");
      setPassword("");
      setConfirm("");
    };

    setLoading(true);
    setError("");
    try {
      if (isReauth) {
        await twoFactor.run(() => login(password), () => connected(syncNow));
      } else if (isAdd) {
        // Nothing of the current session is touched until the server accepts these.
        await twoFactor.run(
          () => authenticateServerAccount(isRegister ? "register" : "signin", email, password, normalizedUrl),
          async (session) => {
            await addAccount(session);
            onClose();
          },
        );
      } else if (isRegister) {
        if (isLocalNoPassword) await setMasterPassword(password);
        await linkToCloud(email, normalizedUrl);
        await connected(syncOnLogin);
      } else {
        await twoFactor.run(() => signInToCloud(email, password, normalizedUrl), () => connected(syncOnLoginReplace));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} blur>
      <ModalCard className="flex flex-col gap-5 p-6" style={{ width: "min(27rem, 92vw)" }}>
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
          >
            <Icon icon="lucide:cloud" width={20} style={{ color: "var(--t-accent)" }} />
          </div>
          <div>
            <p className="text-base font-semibold text-(--t-text-primary) mb-1">
              {isReauth
                ? t("layout.cloudAuthModal.reauthTitle")
                : isAdd
                  ? t("layout.cloudAuthModal.addTitle")
                  : isRegister ? t("layout.cloudAuthModal.registerTitle") : t("layout.cloudAuthModal.signinTitle")}
            </p>
            <p className="text-sm text-(--t-text-muted) leading-relaxed">
              {isReauth
                ? t("layout.cloudAuthModal.reauthDesc")
                : isAdd
                  ? t("layout.cloudAuthModal.addDesc")
                  : isRegister ? t("layout.cloudAuthModal.registerDesc") : t("layout.cloudAuthModal.signinDesc")}
            </p>
          </div>
        </div>

        {twoFactor.challenge ? (
          <TwoFactorStep
            challenge={twoFactor.challenge}
            onCancel={twoFactor.cancel}
            inputClassName={AUTH_INPUT_CLASS}
            buttonClassName="py-2.5"
          />
        ) : (<>
        {!isReauth && <div className="flex rounded-lg overflow-hidden border border-(--t-border)">
          {(["signin", "register"] as CloudAuthMode[]).map((next) => {
            const active = mode === next;
            return (
              <button
                key={next}
                type="button"
                onClick={() => switchMode(next)}
                className="flex-1 py-1.5 text-xs font-medium transition-colors"
                style={{ background: active ? "var(--t-accent)" : "var(--t-bg-elevated)", color: active ? "#fff" : "var(--t-text-muted)" }}
              >
                {next === "signin" ? t("layout.auth.signIn") : t("layout.auth.createAccount")}
              </button>
            );
          })}
        </div>}

        <form onSubmit={submit} className="space-y-2">
          <AuthInput type="email" placeholder={t("layout.auth.emailPlaceholder")} value={email} onChange={setEmail}
            autoFocus={!isReauth} disabled={isReauth} />
          {!isRegister && (
            <AuthInput type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password} onChange={setPassword}
              autoFocus={isReauth} />
          )}
          {needsNewPassword && (
            <>
              <AuthInput type="password" placeholder={t("layout.cloudAuthModal.createMasterPasswordPlaceholder")} value={password} onChange={setPassword} />
              <AuthInput type="password" placeholder={t("layout.cloudAuthModal.confirmMasterPasswordPlaceholder")} value={confirm} onChange={setConfirm} />
            </>
          )}

          {!isReauth && <ServerUrlField value={serverUrl} onChange={setServerUrl} inputClassName={AUTH_INPUT_CLASS} />}

          {error && <p className="text-xs px-1 text-(--t-status-error)">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {loading ? t("layout.cloudAuthModal.pleaseWait") : isRegister ? t("layout.auth.createAccount") : t("layout.auth.signIn")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost w-full py-2.5 rounded-lg text-sm"
          >
            {t("common.action.cancel")}
          </button>
        </form>
        </>)}
      </ModalCard>
    </Modal>
  );
}

function AuthInput({
  type,
  placeholder,
  value,
  onChange,
  autoFocus,
  disabled,
}: {
  type: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={AUTH_INPUT_CLASS}
    />
  );
}
