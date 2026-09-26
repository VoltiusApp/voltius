import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormSelect } from "@/components/shared/FormSelect";
import { SecretInput } from "@/components/shared/vaultObjectForm";
import { DEFAULT_PROXY_PORT } from "@/services/proxy";
import { formIdentifierProps, formInputClass, formInputStyle, formLabelClass, formLabelStyle } from "@/components/shared/Panel";

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
  passwordError?: string;
  disabled?: boolean;
  renderRow?: (select: ReactNode) => ReactNode;
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

export default function ProxyFields({
  modes,
  value,
  onChange,
  password,
  passwordSaved,
  onPasswordChange,
  onPasswordBlur,
  passwordError,
  disabled,
  renderRow = (select) => select,
  className = "",
}: ProxyFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [badPort, setBadPort] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const custom = value.mode === "socks5" || value.mode === "http";

  const changePort = (text: string) => {
    const port = parsePort(text);
    if (port === null) {
      setBadPort(text);
      return;
    }
    setBadPort(null);
    onChange({ ...value, port });
  };

  const label = (field: string) => (
    <label htmlFor={`${id}-${field}`} className={formLabelClass} style={formLabelStyle}>{t(`connections.form.proxy.${field}`)}</label>
  );

  const select = (
    <FormSelect
      className="w-36 shrink-0"
      ariaLabel={t("connections.form.proxy.label")}
      value={value.mode}
      options={modes}
      disabled={disabled}
      onChange={(mode) => { setBadPort(null); onChange({ ...value, mode }); }}
    />
  );

  return (
    <>
      {renderRow(select)}
      {custom && (
        <div className={`flex flex-col gap-2.5 ${className}`}>
          <div className="flex gap-2.5">
            <div className="flex-1 min-w-0">
              {label("host")}
              <input
                id={`${id}-host`}
                className={formInputClass}
                style={formInputStyle}
                value={value.host ?? ""}
                placeholder="proxy.example.com"
                disabled={disabled}
                onChange={(e) => onChange({ ...value, host: e.target.value.trim() || undefined })}
                {...formIdentifierProps}
              />
            </div>
            <div className="w-20 shrink-0">
              {label("port")}
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
              />
            </div>
          </div>
          {!value.host && (
            <FieldError>{t("connections.form.proxy.hostMissing", { kind: modes.find((m) => m.value === value.mode)?.label ?? value.mode })}</FieldError>
          )}
          {badPort !== null && <FieldError>{t("connections.form.proxy.portInvalid")}</FieldError>}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="min-w-0">
              {label("username")}
              <input
                id={`${id}-username`}
                className={formInputClass}
                style={formInputStyle}
                value={value.username ?? ""}
                placeholder={t("connections.form.optional")}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, username: e.target.value || undefined })}
                {...formIdentifierProps}
              />
            </div>
            <div className="min-w-0">
              {label("password")}
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
              />
            </div>
          </div>
          {passwordError && <FieldError>{passwordError}</FieldError>}
        </div>
      )}
    </>
  );
}
