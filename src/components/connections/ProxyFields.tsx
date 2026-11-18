import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormSelect } from "@/components/shared/FormSelect";
import { SecretInput } from "@/components/shared/vaultObjectForm";
import { DEFAULT_PROXY_PORT, isCustomProxyMode } from "@/services/proxy";
import { formIdentifierProps, formInputClass, formInputStyle, formLabelClass, formLabelStyle } from "@/components/shared/Panel";
import { ManagedWhen } from "@/components/shared/ManagedNote";
import { usePolicyLock } from "@/stores/policyStore";

export interface ProxyFieldsValue {
  mode: string;
  host?: string;
  port?: number;
  username?: string;
}

interface ProxyFieldsProps {
  modes: { value: string; label: string }[];
  value: ProxyFieldsValue;
  onChange: (next: ProxyFieldsValue) => void;
  password: string;
  passwordSaved: boolean;
  onPasswordChange: (pw: string) => void;
  onPasswordBlur?: () => void;
  onTextBlur?: () => void;
  passwordError?: string;
  disabled?: boolean;
  /** "host": a lock disables every field, since a host's own proxy is ignored under it. */
  scope?: "global" | "host";
  /** `locked`: the admin's proxy lock applies; the row shows its note. */
  renderRow?: (select: ReactNode, locked: boolean) => ReactNode;
  className?: string;
}

function FieldError({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-xs text-(--t-status-error)">{children}</p>;
}

function parsePort(text: string): number | undefined | null {
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function useProxyLock(modes: ProxyFieldsProps["modes"]): Partial<ProxyFieldsValue> | undefined {
  const lock = usePolicyLock("appSettings.proxy");
  if (!lock.locked) return undefined;
  const fields = lock.value as ProxyFieldsValue;
  // A mode this select doesn't offer (a host's "none") reads as inheriting the global proxy.
  return { ...fields, mode: modes.some((m) => m.value === fields.mode) ? fields.mode : "" };
}

export default function ProxyFields({
  modes,
  value: own,
  onChange,
  password,
  passwordSaved,
  onPasswordChange,
  onPasswordBlur,
  onTextBlur,
  passwordError,
  disabled,
  scope = "global",
  renderRow = (select) => select,
  className = "",
}: ProxyFieldsProps) {
  const { t } = useTranslation();
  const lock = useProxyLock(modes);
  const value = lock ? { ...own, ...lock } : own;
  const patch = (fields: Partial<ProxyFieldsValue>) => onChange({ ...own, ...fields });
  const lockable = (field: string, control: ReactNode) => (
    <ManagedWhen locked={!!lock && (scope === "host" || field in lock)} note={false}>{control}</ManagedWhen>
  );
  const id = useId();
  const [badPort, setBadPort] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const custom = isCustomProxyMode(value.mode);

  const changePort = (text: string) => {
    const port = parsePort(text);
    if (port === null) {
      setBadPort(text);
      return;
    }
    setBadPort(null);
    patch({ port });
  };

  const label = (field: string) => (
    <label htmlFor={`${id}-${field}`} className={formLabelClass} style={formLabelStyle}>{t(`connections.form.proxy.${field}`)}</label>
  );

  const select = lockable("mode",
    <FormSelect
      className="w-36 shrink-0"
      ariaLabel={t("connections.form.proxy.label")}
      value={value.mode}
      options={modes}
      disabled={disabled}
      onChange={(mode) => { setBadPort(null); patch({ mode }); }}
    />,
  );

  return (
    <>
      {renderRow(select, !!lock)}
      {custom && (
        <div className={`flex flex-col gap-2.5 ${className}`}>
          <div className="flex gap-2.5">
            <div className="flex-1 min-w-0">
              {label("host")}
              {lockable("host",
              <input
                id={`${id}-host`}
                className={formInputClass}
                style={formInputStyle}
                value={value.host ?? ""}
                placeholder="proxy.example.com"
                disabled={disabled}
                onChange={(e) => patch({ host: e.target.value.trim() || undefined })}
                onBlur={onTextBlur}
                {...formIdentifierProps}
              />)}
            </div>
            <div className="w-20 shrink-0">
              {label("port")}
              {lockable("port",
              <input
                id={`${id}-port`}
                aria-invalid={badPort !== null}
                inputMode="numeric"
                className={formInputClass}
                style={formInputStyle}
                value={badPort ?? (value.port ? String(value.port) : "")}
                placeholder={String(DEFAULT_PROXY_PORT[value.mode as keyof typeof DEFAULT_PROXY_PORT])}
                disabled={disabled}
                onChange={(e) => changePort(e.target.value.trim())}
              />)}
            </div>
          </div>
          {!value.host && (
            <FieldError>{t("connections.form.proxy.hostMissing", { kind: modes.find((m) => m.value === value.mode)?.label ?? value.mode })}</FieldError>
          )}
          {badPort !== null && <FieldError>{t("connections.form.proxy.portInvalid")}</FieldError>}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0">
              {label("username")}
              {lockable("username",
              <input
                id={`${id}-username`}
                className={formInputClass}
                style={formInputStyle}
                value={value.username ?? ""}
                placeholder={t("connections.form.optional")}
                disabled={disabled}
                onChange={(e) => patch({ username: e.target.value || undefined })}
                onBlur={onTextBlur}
                {...formIdentifierProps}
              />)}
            </div>
            <div className="min-w-0">
              {label("password")}
              {lockable("password",
              <SecretInput
                id={`${id}-password`}
                value={password}
                onChange={onPasswordChange}
                onBlur={onPasswordBlur}
                placeholder={passwordSaved ? t("connections.form.proxy.passwordSaved") : t("connections.form.optional")}
                show={showPassword}
                onToggleShow={() => setShowPassword((v) => !v)}
                autoComplete="new-password"
                disabled={disabled}
              />)}
            </div>
          </div>
          {passwordError && <FieldError>{passwordError}</FieldError>}
        </div>
      )}
    </>
  );
}
