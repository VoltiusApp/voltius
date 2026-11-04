import { useEffect, useState, type ComponentProps, type FormEvent } from "react";
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
import { leaveLanGroup, startSessionSync } from "@/services/lanSync";
import { ServerUrlField } from "@/components/shared/ServerUrlField";
import { TwoFactorStep, useTwoFactorChallenge } from "@/components/shared/TwoFactorStep";
import { resolveServerUrl, startingServerUrl } from "@/services/policy/serverPolicy";
import { usePolicyLock } from "@/stores/policyStore";
import { localSyncContext, usePlatform } from "@/utils/platform";
import { Input, MasterPasswordNote, MIN_PASSWORD_LENGTH, emailError } from "./authParts";

const AUTH_INPUT_CLASS =
  "w-full px-3 py-2.5 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) focus:border-(--t-accent)";

export default function CloudAuthModal() {
  const { t } = useTranslation();
  const lanContext = localSyncContext(usePlatform());
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
  const [serverUrl, setServerUrl] = useState(startingServerUrl);
  const serverLocked = usePolicyLock("server.url").locked;
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

  const switchMode = (next: CloudAuthMode) => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalidEmail = emailError(email, t);
    if (invalidEmail) { setError(invalidEmail); return; }
    const normalizedUrl = resolveServerUrl(serverUrl);

    if (!isRegister && password.length < 1) { setError(t("layout.cloudAuthModal.errorPasswordRequired")); return; }
    if (needsNewPassword) {
      if (password.length < MIN_PASSWORD_LENGTH) { setError(t("layout.auth.errorMinLength8")); return; }
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
        await linkToCloud(email, normalizedUrl, leaveLanGroup);
        await connected(syncOnLogin);
      } else {
        await twoFactor.run(
          () => signInToCloud(email, password, normalizedUrl, leaveLanGroup),
          () => connected(syncOnLoginReplace),
        );
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
                  : isRegister ? t("layout.cloudAuthModal.registerDesc", { context: lanContext }) : t("layout.cloudAuthModal.signinDesc", { context: lanContext })}
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
                style={{ background: active ? "var(--t-accent)" : "var(--t-bg-elevated)", color: active ? "var(--t-on-accent)" : "var(--t-text-secondary)" }}
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
              <MasterPasswordNote />
            </>
          )}

          {!isReauth && <ServerUrlField value={serverUrl} onChange={setServerUrl} inputClassName={AUTH_INPUT_CLASS} locked={serverLocked} />}

          {error && <p role="alert" className="text-xs px-1 text-(--t-status-error)">{error}</p>}

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

function AuthInput(props: Omit<ComponentProps<typeof Input>, "className">) {
  return <Input {...props} className={AUTH_INPUT_CLASS} />;
}
