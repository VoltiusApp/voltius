import { useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { changeMasterPassword } from "@/services/account";
import { SettingsInput } from "./shared";

interface Props {
  onClose: () => void;
}

export default function ChangeMasterPasswordModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
      await changeMasterPassword(currentPassword, newPassword);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-xl p-5 shadow-2xl bg-(--t-bg-terminal) border border-(--t-border)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-(--t-text-primary)">{t("settings.account.changeMasterPassword.title")}</h2>
          <button
            onClick={onClose}
            className="text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
          >
            <Icon icon="lucide:x" width={14} />
          </button>
        </div>

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
            {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary flex-1 py-1.5 rounded-lg text-sm"
              >
                {t("settings.shared.cancel")}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary flex-1 py-1.5 rounded-lg text-sm font-medium"
                style={{ opacity: loading ? 0.7 : 1 }}
              >
                {loading ? t("settings.account.changeMasterPassword.changing") : t("settings.account.changeMasterPassword.changeBtn")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
