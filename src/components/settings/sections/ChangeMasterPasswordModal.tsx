import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { changeMasterPassword } from "@/services/account";
import { canReadPasswordWithSystemAuth, readPasswordWithSystemAuth } from "@/services/vaultBinding";
import { refreshAccessToken } from "@/services/authTokens";
import { systemAuthMethodKey } from "@/hooks/useSystemAuthPrompt";
import { usePlatform } from "@/utils/platform";
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
  const platform = usePlatform();
  const [deviceAvailable, setDeviceAvailable] = useState(false);
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let alive = true;
    void canReadPasswordWithSystemAuth().then((ok) => alive && setDeviceAvailable(ok)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const verifyWithDevice = async () => {
    setVerifying(true);
    setError("");
    // A password changed elsewhere revokes this session before its access token expires, leaving the stored one stale.
    if ((await refreshAccessToken().catch(() => "failed" as const)) === "revoked") {
      setVerifying(false);
      setError(t("settings.account.changeMasterPassword.deviceSignedOut"));
      return;
    }
    const { outcome, password } = await readPasswordWithSystemAuth(t("settings.account.changeMasterPassword.deviceReason"));
    setVerifying(false);
    if (password) {
      setCurrentPassword(password);
      setDeviceVerified(true);
    } else if (outcome !== "cancelled") {
      setError(t("settings.account.changeMasterPassword.deviceFailed"));
    }
  };

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
          {deviceVerified ? (
            <div className="flex items-center gap-2 px-1 py-2 text-(--t-status-connected)">
              <Icon icon="lucide:shield-check" width={14} />
              <p className="text-xs font-medium">{t("settings.account.changeMasterPassword.verifiedWithDevice")}</p>
            </div>
          ) : (
            <>
              <SettingsInput
                type="password"
                placeholder={t("settings.account.changeMasterPassword.currentPlaceholder")}
                value={currentPassword}
                onChange={setCurrentPassword}
                autoFocus
              />
              {deviceAvailable && (
                <button
                  type="button"
                  onClick={() => void verifyWithDevice()}
                  disabled={verifying}
                  className="flex items-center gap-1.5 px-1 text-xs text-(--t-accent) hover:underline disabled:opacity-50"
                >
                  <Icon icon="lucide:fingerprint" width={13} />
                  {t("settings.account.changeMasterPassword.verifyWithDevice", { method: t(systemAuthMethodKey(platform)) })}
                </button>
              )}
            </>
          )}
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
