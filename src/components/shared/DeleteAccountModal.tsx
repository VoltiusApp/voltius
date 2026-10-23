import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "./ConfirmModal";
import { Modal, ModalCard } from "./Modal";
import { deleteAccount, getCurrentUserEmail } from "@/services/account";
import { appToast } from "@/services/appToast";
import { useServerBillingEnabled } from "@/services/serverCapabilities";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { deleteConfirmationTarget, isDeleteConfirmed, subscriptionRenews } from "@/utils/deleteAccount";

interface Props {
  onCancel: () => void;
  /** Runs once the account is gone and this device is signed out (desktop reloads, mobile pops). */
  onDeleted: () => void;
}

/**
 * Permanently deletes the signed-in cloud account (DELETE /v1/auth/account),
 * then signs this device out through the regular logout path. Offered in every
 * build: store policy requires in-app account deletion.
 */
export function DeleteAccountModal({ onCancel, onDeleted }: Props) {
  const { t } = useTranslation();
  // `undefined` while the keychain answers, so the field never asks for the wrong thing.
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState("");
  const billingEnabled = useServerBillingEnabled();
  const status = useSubscriptionStore((s) => s.subscriptionStatus);
  const cancelled = useSubscriptionStore((s) => s.subscriptionCancelled);

  useEffect(() => {
    void getCurrentUserEmail().then(setEmail, () => setEmail(null));
  }, []);

  if (deleted) {
    // Held open until acknowledged: the desktop reload that follows would swallow the toast.
    return (
      <Modal onClose={onDeleted} onEnter={onDeleted}>
        <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[26.667rem]">
          <div className="flex items-center gap-3">
            <Icon icon="lucide:circle-check" width={20} className="shrink-0 text-(--t-status-connected)" />
            <h2 className="text-sm font-semibold text-(--t-text-bright)">{t("shared.deleteAccount.deletedTitle")}</h2>
          </div>
          <p className="text-sm text-(--t-text-secondary)">{t("shared.deleteAccount.deleted")}</p>
          <div className="flex justify-end">
            <button data-delete-account-done onClick={onDeleted} className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium">
              {t("common.action.close")}
            </button>
          </div>
        </ModalCard>
      </Modal>
    );
  }

  const loaded = email !== undefined;
  const confirmed = loaded && isDeleteConfirmed(input, email);
  const submit = () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    deleteAccount()
      .then(() => {
        appToast("success", t("shared.deleteAccount.deleted"));
        setDeleted(true);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  return (
    <ConfirmModal
      title={t("shared.deleteAccount.title")}
      message={t("shared.deleteAccount.message")}
      confirmLabel={t("shared.deleteAccount.confirm")}
      busy={busy || !confirmed}
      busyLabel={busy ? t("shared.deleteAccount.deleting") : undefined}
      onConfirm={submit}
      onCancel={busy ? () => {} : onCancel}
    >
      <p className="text-sm text-(--t-text-secondary)">{t("shared.deleteAccount.deviceNote")}</p>
      {subscriptionRenews({ billingEnabled, status, cancelled }) && (
        <p data-delete-account-subscription-note className="text-sm text-(--t-text-secondary)">{t("shared.deleteAccount.subscriptionNote")}</p>
      )}
      {loaded && (
        <label className="flex flex-col gap-1.5 text-sm text-(--t-text-secondary)">
          <span>{t("shared.deleteAccount.typeToConfirm", { target: deleteConfirmationTarget(email) })}</span>
          <input
            data-delete-account-confirm-input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          />
        </label>
      )}
      {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
    </ConfirmModal>
  );
}
