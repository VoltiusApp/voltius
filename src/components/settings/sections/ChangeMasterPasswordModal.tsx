import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { changeMasterPassword } from "@/services/account";
import { INPUT_CLASS } from "@/components/layout/authParts";
import {
  EMPTY_TWO_FACTOR_ENTRY, TwoFactorField, entryProof, usePasskeyCeremony, wasCancelled, type TwoFactorEntry,
} from "@/components/shared/TwoFactorStep";
import { factorMethods, getFactors, passkeyStepUp } from "@/services/twoFactor";
import type { TwoFactorMethod, TwoFactorProof } from "@/services/twoFactorProof";
import { FormButtons, SettingsDialog, SettingsInput } from "./shared";

interface Props {
  /** The server asks for a code with the change once the account has a second factor. */
  twoFactorEnabled?: boolean;
  onClose: () => void;
}

export default function ChangeMasterPasswordModal({ twoFactorEnabled, onClose }: Props) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [twoFactor, setTwoFactor] = useState<TwoFactorEntry>(EMPTY_TWO_FACTOR_ENTRY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [methods, setMethods] = useState<TwoFactorMethod[]>(["totp", "recovery"]);
  const passkey = usePasskeyCeremony();

  useEffect(() => {
    if (!twoFactorEnabled) return;
    let alive = true;
    void getFactors(true).then((factors) => alive && setMethods(factorMethods(factors))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [twoFactorEnabled]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void change(async () => entryProof(twoFactor));
  };

  const change = async (getProof: () => Promise<TwoFactorProof | null>) => {
    if (!currentPassword) {
      setError(t("settings.account.changeMasterPassword.errorCurrentRequired"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("settings.account.changeMasterPassword.errorMinLength"));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t("settings.account.changeMasterPassword.errorSamePassword"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.account.error.mismatch"));
      return;
    }

    setLoading(true);
    setError("");
    try {
      await changeMasterPassword(currentPassword, newPassword, twoFactorEnabled ? await getProof() : null);
      setDone(true);
    } catch (e) {
      if (!wasCancelled(e)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsDialog title={t("settings.account.changeMasterPassword.title")} onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-(--t-status-connected)">
            <Icon icon="lucide:circle-check-big" width={14} />
            <p className="text-xs font-medium">{t("settings.account.changeMasterPassword.successMsg")}</p>
          </div>
          <p className="text-xs text-(--t-text-dim)">
            {t("settings.account.changeMasterPassword.successNote")}
          </p>
          <button
            onClick={onClose}
            className="btn btn-primary w-full py-1.5 rounded-lg text-sm font-medium"
          >
            {t("settings.account.changeMasterPassword.done")}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <SettingsInput
            type="password"
            placeholder={t("settings.account.changeMasterPassword.currentPlaceholder")}
            value={currentPassword}
            onChange={setCurrentPassword}
            autoFocus
          />
          <SettingsInput
            type="password"
            placeholder={t("settings.account.changeMasterPassword.newPlaceholder")}
            value={newPassword}
            onChange={setNewPassword}
          />
          <SettingsInput
            type="password"
            placeholder={t("settings.account.changeMasterPassword.confirmPlaceholder")}
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
          {twoFactorEnabled && (
            <TwoFactorField
              entry={twoFactor}
              onChange={setTwoFactor}
              inputClassName={INPUT_CLASS}
              methods={methods}
              passkey={{ start: () => void change(() => passkey.track(passkeyStepUp)), waiting: passkey.waiting }}
            />
          )}
          {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
          <FormButtons
            onCancel={onClose}
            submitting={loading}
            submitLabel={loading ? t("settings.account.changeMasterPassword.changing") : t("settings.account.changeMasterPassword.changeBtn")}
          />
        </form>
      )}
    </SettingsDialog>
  );
}
