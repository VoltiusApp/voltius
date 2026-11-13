import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "@iconify/react";
import { RevealToggle } from "@/components/shared/vaultObjectForm";
import LogoBadge from "./LogoBadge";
import { systemAuthMethodKey, type SystemAuthPrompt } from "@/hooks/useSystemAuthPrompt";
import { usePlatform } from "@/utils/platform";

export function Layout({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="h-full w-full flex flex-col items-center overflow-y-auto pt-[max(4rem,16vh)] pb-8 bg-(--t-bg-terminal)">
      {onBack && (
        <button onClick={onBack}
          className="focus-ring absolute top-[max(1.5rem,env(safe-area-inset-top))] left-6 flex items-center gap-1.5 text-xs transition-colors text-(--t-text-secondary) hover:text-(--t-text-primary)"
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
      className="focus-ring w-full flex items-center gap-3 px-4 py-3 rounded-xl mb-2 text-left transition-all"
      style={{
        background: primary ? "var(--t-accent)" : "var(--t-bg-elevated)",
        border: `1px solid ${primary ? "var(--t-accent)" : "var(--t-border)"}`,
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
      }}
      onMouseLeave={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
      }}
    >
      <Icon icon={loading ? "lucide:loader-circle" : icon} width={18}
        className={`shrink-0 ${loading ? "animate-spin" : ""}`}
        style={{ color: primary ? "var(--t-on-accent)" : "var(--t-accent)" }} />
      <div>
        <p className="text-sm font-medium" style={{ color: primary ? "var(--t-on-accent)" : "var(--t-text-primary)" }}>
          {label}
        </p>
        {sub && (
          <p className="text-xs" style={{ color: primary ? "color-mix(in srgb, var(--t-on-accent) 80%, transparent)" : "var(--t-text-secondary)" }}>
            {sub}
          </p>
        )}
      </div>
    </button>
  );
}

export const INPUT_CLASS =
  "form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)";

export function Input({ type, placeholder, value, onChange, autoFocus, invalid, disabled, className = INPUT_CLASS }: {
  type: string; placeholder: string; value: string;
  onChange: (v: string) => void; autoFocus?: boolean; invalid?: boolean; disabled?: boolean; className?: string;
}) {
  const [shown, setShown] = useState(false);
  const secret = type === "password";
  const input = (
    <input
      type={secret && shown ? "text" : type}
      placeholder={placeholder}
      aria-label={placeholder}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      disabled={disabled}
      className={secret ? `${className} pr-9` : className}
    />
  );
  if (!secret) return input;
  return (
    <div className="relative">
      {input}
      <RevealToggle show={shown} onToggle={() => setShown((v) => !v)} />
    </div>
  );
}

export const MIN_PASSWORD_LENGTH = 8;

export function emailError(email: string, t: TFunction): string {
  if (!email.trim()) return t("layout.auth.errorEmailRequired");
  return email.includes("@") ? "" : t("layout.auth.errorInvalidEmail");
}

export function newPasswordProblem(password: string, confirm: string, t: TFunction): string {
  if (password.length < MIN_PASSWORD_LENGTH) return t("layout.auth.errorMinLength8");
  return password === confirm ? "" : t("layout.auth.errorPasswordMismatch");
}

export function FormNote({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-xs leading-relaxed text-(--t-text-secondary) py-1">
      <Icon icon={icon} width={13} className="shrink-0 mt-0.5 text-(--t-text-dim)" />
      {children}
    </p>
  );
}

export function DisclosureToggle({ open, onToggle, label, align = "center" }: {
  open: boolean; onToggle: () => void; label: string; align?: "center" | "start";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`focus-ring flex items-center gap-1 w-full text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary) ${align === "center" ? "justify-center" : "text-left"}`}
    >
      <Icon icon={open ? "lucide:chevron-down" : "lucide:chevron-right"} width={12} />
      {label}
    </button>
  );
}

export function MasterPasswordNote() {
  const { t } = useTranslation();
  return <FormNote icon="lucide:key-round">{t("layout.auth.masterPasswordNote")}</FormNote>;
}

export function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p role="alert" className="text-xs text-center py-1 text-(--t-status-error)">{msg}</p>;
}

export function SubmitBtn({ loading, label, disabled = false }: { loading: boolean; label: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={loading || disabled}
      className="btn btn-primary w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
      style={{ opacity: loading || disabled ? 0.7 : 1 }}
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
      {auth.outcome === "invalidated" && <ErrorMsg msg={t("layout.appLock.bindingLost")} />}
      {auth.outcome === "declined" && <ErrorMsg msg={t("layout.appLock.keychainEmpty")} />}
    </>
  );
}

export function SwitchModeLink({ prompt, label, onClick }: { prompt: string; label: string; onClick: () => void }) {
  return (
    <p className="mt-3 text-center text-xs text-(--t-text-secondary)">
      {prompt}
      <button type="button" onClick={onClick} className="focus-ring text-(--t-accent) hover:underline">{label}</button>
    </p>
  );
}
