import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ActionButton, ErrorMsg, INPUT_CLASS, Input, Layout, SubmitBtn, SystemAuthButton } from "./authParts";
import {
  createLocalAccountNoPassword,
  createServerAccount,
  login,
} from "@/services/account";
import { useNotificationStore } from "@/stores/notificationStore";
import { VaultUnreadableError } from "@/services/vaultErrors";
import { VaultBackups } from "@/components/shared/VaultBackups";
import { ServerUrlField } from "@/components/shared/ServerUrlField";
import { lastServerUrl } from "@/utils/serverInstance";
import { useSystemAuthPrompt } from "@/hooks/useSystemAuthPrompt";
import { rebindAfterPassword, unlockWithSystemAuth } from "@/services/vaultBinding";


type View = "home" | "cloud";
type CloudMode = "signup" | "signin";

interface Props {
  isLocked: boolean;
  /** The vault was already found unreadable at startup, before any password was
   *  asked for — an account whose only key lives in the OS keychain. */
  vaultUnreadable?: boolean;
  /** Offer the OS prompt: the vault key was kept in the keychain when it was locked. */
  systemAuth?: boolean;
  onReady: () => void;
}

/** Which way the vault turned out to be unreadable — they offer different exits. */
type Unreadable = "no-password" | "wrong-key";

export default function AuthPage({ isLocked, vaultUnreadable, systemAuth, onReady }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("home");
  const [cloudMode, setCloudMode] = useState<CloudMode>("signup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unreadable, setUnreadable] = useState<Unreadable | null>(
    vaultUnreadable ? "no-password" : null,
  );

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [serverUrl, setServerUrl] = useState(lastServerUrl);
  const addToast = useNotificationStore((s) => s.addToast);

  const reset = (v: View, mode?: CloudMode) => {
    setView(v);
    if (mode) setCloudMode(mode);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const wrap = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError("");
    try {
      await fn();
      onReady();
    } catch (e) {
      // Not a bad password, so not the password form.
      if (e instanceof VaultUnreadableError) setUnreadable("wrong-key");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const [bindingLost, setBindingLost] = useState(false);
  const auth = useSystemAuthPrompt(isLocked && !!systemAuth, async (reason) => {
    const r = await unlockWithSystemAuth(reason);
    if (r === "invalidated") setBindingLost(true);
    return r;
  }, onReady);

  // ── Vault present but unreadable ─────────────────────────────────────────

  if (unreadable) {
    const setAside = () =>
      wrap(async () => {
        const { quarantineVault } = await import("@/services/vault");
        const backup = await quarantineVault();
        addToast({
          source: { kind: "plugin", id: "system", name: "Voltius" },
          type: "toast",
          message: t("layout.auth.vaultSetAsideToast", { file: backup }),
          severity: "info",
          duration: 8000,
        });
        window.location.reload();
      });

    // No password was ever asked for, so there is no other one to try and no
    // cloud copy to re-download: the backups below are the only way back.
    const noPassword = unreadable === "no-password";

    return (
      <Layout>
        <p className="text-sm mb-2 text-center text-(--t-text-bright)">
          {t("layout.auth.vaultUnreadableTitle")}
        </p>
        <p className="text-xs mb-4 text-center leading-relaxed text-(--t-text-muted)">
          {t(noPassword ? "layout.auth.vaultUnreadableBodyNoPassword" : "layout.auth.vaultUnreadableBody")}
        </p>
        <ErrorMsg msg={error} />
        <ActionButton
          icon={noPassword ? "lucide:archive" : "lucide:cloud-download"}
          label={t(noPassword ? "layout.auth.vaultSetAsideLocal" : "layout.auth.vaultSetAside")}
          sub={t(noPassword ? "layout.auth.vaultSetAsideLocalSub" : "layout.auth.vaultSetAsideSub")}
          primary
          loading={loading}
          onClick={setAside}
        />
        {!noPassword && (
          <button
            type="button"
            onClick={() => { setUnreadable(null); setError(""); setPassword(""); }}
            className="mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
          >
            {t("layout.auth.vaultUnreadableRetry")}
          </button>
        )}
        <VaultBackups currentReadable={false} hideWhenEmpty className="mt-4 w-full text-left" />
      </Layout>
    );
  }

  // ── Locked (vault exists, need password) ─────────────────────────────────

  if (isLocked) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      await wrap(async () => {
        await login(password);
        if (bindingLost) await rebindAfterPassword(password, t("layout.appLock.sealReason"));
      });
    };
    return (
      <Layout>
        <p className="text-xs mb-4 text-center text-(--t-text-muted)">
          {t("layout.auth.unlockPrompt")}
        </p>
        <SystemAuthButton auth={auth} loading={loading} />
        <form onSubmit={submit} className="w-full space-y-2">
          <Input type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password}
            onChange={setPassword} autoFocus={!systemAuth} />
          <ErrorMsg msg={error} />
          <SubmitBtn loading={loading} label={t("layout.auth.unlock")} />
        </form>
        <button
          type="button"
          onClick={async () => {
            const { resetVault } = await import("@/services/vault");
            await resetVault();
            window.location.reload();
          }}
          className="mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-status-error)"
        >
          {t("layout.auth.resetVault")}
        </button>
      </Layout>
    );
  }

  // ── Home (first launch) ──────────────────────────────────────────────────

  if (view === "home") {
    return (
      <Layout>
        <p className="text-xs mb-6 text-center text-(--t-text-muted)">
          {t("layout.auth.chooseHowToUse")}
        </p>

        <ActionButton
          icon="lucide:zap"
          label={t("layout.auth.getStarted")}
          sub={t("layout.auth.getStartedSub")}
          primary
          loading={loading}
          onClick={() => wrap(createLocalAccountNoPassword)}
        />

        <div className="flex items-center gap-2 my-4">
          <div className="flex-1 h-px bg-(--t-border)" />
          <span className="text-xs text-(--t-text-dim)">{t("layout.auth.or")}</span>
          <div className="flex-1 h-px bg-(--t-border)" />
        </div>

        <ActionButton
          icon="lucide:cloud"
          label={t("layout.auth.cloudAccount")}
          sub={t("layout.auth.cloudAccountSub")}
          onClick={() => reset("cloud", "signup")}
        />
      </Layout>
    );
  }

  // ── Cloud (merged sign-up / sign-in) ─────────────────────────────────────

  if (view === "cloud") {
    const isSignup = cloudMode === "signup";

    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.includes("@")) { setError(t("layout.auth.errorInvalidEmail")); return; }
      const normalizedUrl = serverUrl.replace(/\/+$/, "");
      if (isSignup) {
        if (password.length < 8) { setError(t("layout.auth.errorMinLength8")); return; }
        if (password !== confirm) { setError(t("layout.auth.errorPasswordMismatch")); return; }
        await wrap(async () => {
          await createServerAccount(email, password, normalizedUrl);
          addToast({
            source: { kind: "plugin", id: "system", name: "Voltius" },
            type: "toast",
            message: t("layout.auth.accountCreatedToast"),
            severity: "info",
            duration: 5000,
          });
        });
      } else {
        await wrap(() => login(password, email, normalizedUrl));
      }
    };

    return (
      <Layout onBack={() => reset("home")}>
        <p className="text-xs mb-4 text-center text-(--t-text-muted)">
          {isSignup ? t("layout.auth.signupPrompt") : t("layout.auth.signinPrompt")}
        </p>
        <form onSubmit={submit} className="w-full space-y-2">
          <Input type="email" placeholder={t("layout.auth.emailPlaceholder")} value={email} onChange={setEmail} autoFocus />
          <Input type="password" placeholder={isSignup ? t("layout.auth.masterPasswordMinPlaceholder") : t("layout.auth.masterPasswordPlaceholder")}
            value={password} onChange={setPassword} />
          {isSignup && (
            <Input type="password" placeholder={t("layout.auth.confirmPasswordPlaceholder")} value={confirm} onChange={setConfirm} />
          )}
          <ServerUrlField value={serverUrl} onChange={setServerUrl} inputClassName={INPUT_CLASS} />
          <ErrorMsg msg={error} />
          <SubmitBtn loading={loading} label={isSignup ? t("layout.auth.createAccount") : t("layout.auth.signIn")} />
        </form>

        <div className="mt-3 text-center">
          {isSignup ? (
            <>
              <span className="text-xs text-(--t-text-dim)">{t("layout.auth.alreadyHaveAccount")}</span>
              <button
                type="button"
                onClick={() => { setCloudMode("signin"); setError(""); setConfirm(""); }}
                className="text-xs text-(--t-accent) hover:underline"
              >
                {t("layout.auth.signIn")}
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-(--t-text-dim)">{t("layout.auth.newHere")}</span>
              <button
                type="button"
                onClick={() => { setCloudMode("signup"); setError(""); }}
                className="text-xs text-(--t-accent) hover:underline"
              >
                {t("layout.auth.createAccount")}
              </button>
            </>
          )}
        </div>

        {isSignup && (
          <p className="mt-2 text-xs text-center text-(--t-text-dim) leading-relaxed">
            {t("layout.auth.e2eeNotice")}{" "}
            <button type="button" onClick={() => void openUrl("https://github.com/VoltiusApp/voltius")}
              className="text-(--t-accent) hover:underline">
              {t("layout.auth.openSource")}
            </button>
            <br />
            <Trans
              i18nKey="layout.auth.agreeToTerms"
              components={{
                terms: <button type="button" onClick={() => void openUrl("https://voltius.app/terms")} className="text-(--t-accent) hover:underline" />,
                privacy: <button type="button" onClick={() => void openUrl("https://voltius.app/privacy")} className="text-(--t-accent) hover:underline" />,
              }}
            />
          </p>
        )}
      </Layout>
    );
  }

  return null;
}
