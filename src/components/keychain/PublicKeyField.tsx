import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import {
  formInputClass, formInputStyle, formLabelClass, formLabelStyle,
} from "@/components/shared/Panel";
import { isValidSshPublicKey } from "@/services/sshPublicKey";

/**
 * True when the field holds something that is not a public key. Empty stays
 * legal: the public half is optional, and a key saved without one still works
 * for authentication.
 *
 * The same rule guards the plugin/MCP route and `addKeyToHost`, so a bad value
 * could never reach a remote machine — but it could still be SAVED here, and the
 * user's first symptom was a key that imported without complaint and refused to
 * deploy weeks later. The form is where that is cheap to say.
 */
export function isPublicKeyInvalid(value: string): boolean {
  return value.trim() !== "" && !isValidSshPublicKey(value);
}

/** The optional public-half input, shared by KeyForm and IdentityForm's inline
 *  key material — same rule, same message, same field. */
export function PublicKeyField({
  value,
  onChange,
  heightClass,
}: {
  value: string;
  onChange: (value: string) => void;
  heightClass: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className={formLabelClass} style={formLabelStyle}>
        {t("keychain.common.publicKey")}{" "}
        <span className="text-(--t-text-dim) font-normal">{t("keychain.common.optional")}</span>
      </label>
      <textarea
        className={`${formInputClass} font-mono text-xs ${heightClass} resize-none`}
        style={formInputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ssh-ed25519 AAAA..."
      />
      {isPublicKeyInvalid(value) && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <Icon icon="lucide:circle-x" width={12} className="text-(--t-status-error)" />
          <span className="text-xs text-(--t-status-error)">
            {t("keychain.keyForm.invalidPublicKey")}
          </span>
        </div>
      )}
    </div>
  );
}
