import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { changeEmail } from "@/services/account";
import { useNotificationStore } from "@/stores/notificationStore";
import { FormButtons, SettingsDialog, SettingsInput } from "./shared";

interface Props {
  currentEmail: string;
  onClose: () => void;
}

export default function EditEmailModal({ currentEmail, onClose }: Props) {
  const { t } = useTranslation();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const addToast = useNotificationStore((s) => s.addToast);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newEmail.includes("@")) {
      setError(t("settings.account.editEmail.errorInvalidEmail"));
      return;
    }
    if (newEmail === currentEmail) {
      setError(t("settings.account.editEmail.errorSameEmail"));
      return;
    }
    if (!password) {
      setError(t("settings.account.editEmail.errorPasswordRequired"));
      return;
    }

    setLoading(true);
    setError("");
    try {
      await changeEmail(newEmail, password);
      setDone(true);
      addToast({
        source: { kind: "plugin", id: "system", name: "Voltius" },
        type: "toast",
        message: t("settings.account.editEmail.toastVerification", { email: newEmail }),
        severity: "info",
        duration: 5000,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsDialog title={t("settings.account.editEmail.title")} onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <p className="text-xs text-(--t-text-muted)">
            {t("settings.account.editEmail.updatedPrefix")}
            <strong className="text-(--t-text-primary)">{newEmail}</strong>
            {t("settings.account.editEmail.updatedSuffix")}
          </p>
          <p className="text-xs text-(--t-text-dim)">
            {t("settings.account.editEmail.pausedNote")}
          </p>
          <button
            onClick={onClose}
            className="btn btn-primary w-full py-1.5 rounded-lg text-sm font-medium"
          >
            {t("settings.account.editEmail.done")}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <p className="text-xs text-(--t-text-dim) mb-3">
            {t("settings.account.editEmail.currentLabel")}{" "}
            <span className="text-(--t-text-muted)">{currentEmail}</span>
          </p>
          <SettingsInput
            type="email"
            placeholder={t("settings.account.editEmail.newPlaceholder")}
            value={newEmail}
            onChange={setNewEmail}
            autoFocus
          />
          <SettingsInput
            type="password"
            placeholder={t("settings.account.editEmail.passwordPlaceholder")}
            value={password}
            onChange={setPassword}
          />
          {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
          <FormButtons
            onCancel={onClose}
            submitting={loading}
            submitLabel={loading ? t("settings.account.editEmail.saving") : t("settings.account.editEmail.save")}
          />
        </form>
      )}
    </SettingsDialog>
  );
}
