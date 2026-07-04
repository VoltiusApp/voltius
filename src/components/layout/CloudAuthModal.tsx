import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal } from "@/components/shared/Modal";
import { useUIStore, type CloudAuthMode } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { getAccountMode, linkToCloud, setMasterPassword, signInToCloud } from "@/services/account";
import { startRealtimeSync, syncOnLogin, syncOnLoginReplace } from "@/services/sync";

const DEFAULT_SERVER = "https://api.voltius.app";

export default function CloudAuthModal() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.cloudAuthOpen);
  const mode = useUIStore((s) => s.cloudAuthMode);
  const setMode = useUIStore((s) => s.setCloudAuthMode);
  const onClose = useUIStore((s) => s.closeCloudAuth);
  const reloadSubscription = useSubscriptionStore((s) => s.load);

  const [accountMode, setAccountMode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [showServerUrl, setShowServerUrl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    getAccountMode().then(setAccountMode).catch(() => setAccountMode(null));
    setError("");
  }, [open]);

  if (!open) return null;

  const isRegister = mode === "register";
  const isLocalNoPassword = accountMode === "local-nopassword";

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
    if (isRegister && isLocalNoPassword) {
      if (password.length < 4) { setError(t("layout.cloudAuthModal.errorMinLength4")); return; }
      if (password !== confirm) { setError(t("layout.auth.errorPasswordMismatch")); return; }
    }

    setLoading(true);
    setError("");
    try {
      if (isRegister) {
        if (isLocalNoPassword) await setMasterPassword(password);
        await linkToCloud(email, normalizedUrl);
        syncOnLogin().catch(() => {});
      } else {
        await signInToCloud(email, password, normalizedUrl);
        syncOnLoginReplace().catch(() => {});
      }
      startRealtimeSync();
      await reloadSubscription().catch(() => {});
      onClose();
      setEmail("");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} blur>
      <div
        className="flex flex-col gap-5 bg-(--t-bg-base) border border-(--t-border) p-6"
        style={{ width: "min(27rem, 92vw)", borderRadius: "0.933rem", boxShadow: "var(--t-elev-3)" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
          >
            <Icon icon="lucide:cloud" width={20} style={{ color: "var(--t-accent)" }} />
          </div>
          <div>
            <p className="text-base font-semibold text-(--t-text-primary) mb-1">
              {isRegister ? t("layout.cloudAuthModal.registerTitle") : t("layout.cloudAuthModal.signinTitle")}
            </p>
            <p className="text-sm text-(--t-text-muted) leading-relaxed">
              {isRegister
                ? t("layout.cloudAuthModal.registerDesc")
                : t("layout.cloudAuthModal.signinDesc")
              }
            </p>
          </div>
        </div>

        <div className="flex rounded-lg overflow-hidden border border-(--t-border)">
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
        </div>

        <form onSubmit={submit} className="space-y-2">
          <AuthInput type="email" placeholder={t("layout.auth.emailPlaceholder")} value={email} onChange={setEmail} autoFocus />
          {!isRegister && (
            <AuthInput type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password} onChange={setPassword} />
          )}
          {isRegister && isLocalNoPassword && (
            <>
              <AuthInput type="password" placeholder={t("layout.cloudAuthModal.createMasterPasswordPlaceholder")} value={password} onChange={setPassword} />
              <AuthInput type="password" placeholder={t("layout.cloudAuthModal.confirmMasterPasswordPlaceholder")} value={confirm} onChange={setConfirm} />
            </>
          )}

          <button
            type="button"
            onClick={() => setShowServerUrl((v) => !v)}
            className="text-xs w-full text-left transition-colors text-(--t-text-dim)"
          >
            {showServerUrl ? "▾" : "▸"} {t("layout.auth.customServerUrl")}
          </button>
          {showServerUrl && (
            <AuthInput type="url" placeholder="https://api.voltius.app" value={serverUrl} onChange={setServerUrl} />
          )}

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
      </div>
    </Modal>
  );
}

function AuthInput({
  type,
  placeholder,
  value,
  onChange,
  autoFocus,
}: {
  type: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2.5 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) placeholder:text-(--t-text-muted) focus:border-(--t-accent)"
    />
  );
}
