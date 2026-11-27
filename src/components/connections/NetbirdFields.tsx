import { useTranslation } from "react-i18next";
import type { NetbirdSettings } from "@/types";
import { FormSelect } from "@/components/shared/FormSelect";
import { formIdentifierProps, formInputClass, formInputStyle, formLabelClass, formLabelStyle } from "@/components/shared/Panel";
import { netbirdComplete, normalizeNetbird } from "@/services/netbirdSettings";
import { FormHint } from "./formShared";

type TextField = Exclude<keyof NetbirdSettings, "token_type">;

const TEXT_FIELDS: { key: TextField; label: string; placeholder?: string; required?: boolean }[] = [
  { key: "issuer", label: "issuer", placeholder: "https://login.example.com/tenant", required: true },
  { key: "client_id", label: "clientId", required: true },
  { key: "fingerprint", label: "fingerprint", placeholder: "SHA256:…", required: true },
  { key: "scope", label: "scope" },
  { key: "audience", label: "audience" },
];

const TOKEN_TYPES = [
  { value: "access_token", label: "access_token" },
  { value: "id_token", label: "id_token" },
];

/** The NetBird settings inputs, shared by the host form and the connection screen. */
export function NetbirdFields({ value, onChange }: { value: NetbirdSettings; onChange: (next: NetbirdSettings) => void }) {
  const { t } = useTranslation();
  const tokenTypeLabel = t("connections.netbird.tokenType");
  return (
    <div className="w-full space-y-3 text-left">
      {TEXT_FIELDS.map(({ key, label, placeholder, required }) => (
        <div key={key}>
          <label className={formLabelClass} style={formLabelStyle}>
            {t(`connections.netbird.${label}`)}
            {required && <span className="text-(--t-accent)"> *</span>}
          </label>
          <input
            className={formInputClass}
            style={formInputStyle}
            aria-label={t(`connections.netbird.${label}`)}
            value={value[key]}
            placeholder={placeholder}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            {...formIdentifierProps}
          />
        </div>
      ))}
      <div>
        <label className={formLabelClass} style={formLabelStyle}>{tokenTypeLabel}</label>
        <FormSelect
          value={value.token_type}
          options={TOKEN_TYPES}
          ariaLabel={tokenTypeLabel}
          title={tokenTypeLabel}
          onChange={(v) => onChange({ ...value, token_type: v as NetbirdSettings["token_type"] })}
        />
      </div>
      {!netbirdComplete(normalizeNetbird(value)) && <FormHint>{t("connections.netbird.incomplete")}</FormHint>}
      <FormHint>{t("connections.netbird.unsupported")}</FormHint>
    </div>
  );
}
