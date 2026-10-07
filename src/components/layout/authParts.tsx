import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import LogoBadge from "./LogoBadge";
import { systemAuthMethodKey, type SystemAuthPrompt } from "@/hooks/useSystemAuthPrompt";
import { usePlatform } from "@/utils/platform";

export function Layout({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-(--t-bg-terminal)">
      {onBack && (
        <button onClick={onBack}
          className="absolute top-6 left-6 flex items-center gap-1.5 text-xs transition-colors text-(--t-text-muted) hover:text-(--t-text-primary)"
        >
          <Icon icon="lucide:arrow-left" width={13} /> {t("layout.auth.back")}
        </button>
      )}

      <div className="mb-8 text-center">
        <LogoBadge size={12} className="mb-3" />
        <h1 className="text-lg font-bold text-(--t-text-bright)">Voltius</h1>
      </div>

      <div className="w-72">{children}</div>
    </div>
  );
}

export function ActionButton({ icon, label, sub, primary, loading, onClick }: {
  icon: string; label: string; sub?: string;
  primary?: boolean; loading?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl mb-2 text-left transition-all"
      style={{
        background: primary ? "var(--t-accent)" : "var(--t-bg-elevated)",
        border: `1px solid ${primary ? "var(--t-accent)" : "var(--t-border)"}`,
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border-hover)";
      }}
      onMouseLeave={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
      }}
    >
      <Icon icon={loading ? "lucide:loader-circle" : icon} width={18}
        className={`shrink-0 ${loading ? "animate-spin" : ""}`}
        style={{ color: primary ? "white" : "var(--t-accent)" }} />
      <div>
        <p className="text-sm font-medium" style={{ color: primary ? "white" : "var(--t-text-primary)" }}>
          {label}
        </p>
        {sub && (
          <p className="text-xs" style={{ color: primary ? "rgba(255,255,255,0.7)" : "var(--t-text-muted)" }}>
            {sub}
          </p>
        )}
      </div>
    </button>
  );
}

export const INPUT_CLASS =
  "form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)";

export function Input({ type, placeholder, value, onChange, autoFocus }: {
  type: string; placeholder: string; value: string;
  onChange: (v: string) => void; autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      className={INPUT_CLASS}
    />
  );
}

export function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="text-xs text-center py-1 text-(--t-status-error)">{msg}</p>;
}

export function SubmitBtn({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button type="submit" disabled={loading}
      className="btn btn-primary w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
      style={{ opacity: loading ? 0.7 : 1 }}
    >
      {loading && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
      {label}
    </button>
  );
}

export function SystemAuthButton({ auth, loading }: { auth: SystemAuthPrompt; loading?: boolean }) {
  const { t } = useTranslation();
  const platform = usePlatform();
  if (!auth.available) return null;
  return (
    <>
      <ActionButton
        icon="lucide:fingerprint"
        label={auth.outcome && auth.outcome !== "ok"
          ? t("layout.appLock.tryAgain")
          : t("layout.appLock.unlockWith", { method: t(systemAuthMethodKey(platform)) })}
        primary
        loading={auth.busy || loading}
        onClick={auth.prompt}
      />
      {auth.outcome === "failed" && <ErrorMsg msg={t("layout.appLock.systemAuthFailed")} />}
    </>
  );
}
