import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { resendVerificationEmail } from "@/services/account";
import { EMAIL_VERIFICATION_REQUIRED_EVENT } from "@/services/billingCheckout";
import { useNotificationStore } from "@/stores/notificationStore";

export function EmailVerificationRequiredModal() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const addToast = useNotificationStore((s) => s.addToast);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, handler);
  }, []);

  if (!visible) return null;

  async function handleResend() {
    setSending(true);
    try {
      await resendVerificationEmail();
      addToast({
        source: { kind: "plugin", id: "system", name: "Voltius" },
        type: "toast",
        message: t("notifications.emailVerification.toast.sent"),
        severity: "success",
        duration: 3500,
      });
    } catch (e) {
      addToast({
        source: { kind: "plugin", id: "system", name: "Voltius" },
        type: "toast",
        message: e instanceof Error ? e.message : t("notifications.emailVerification.toast.sendFailed"),
        severity: "error",
        duration: 5000,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal onClose={() => setVisible(false)}>
      <ModalCard className="flex flex-col gap-4 animate-fadeIn p-8" style={{ width: "min(28rem, 92vw)" }}>
        <div>
          <p className="text-base font-semibold text-(--t-text-primary) mb-1">
            {t("notifications.emailVerification.modal.title")}
          </p>
          <p className="text-sm text-(--t-text-muted) leading-relaxed">
            {t("notifications.emailVerification.modal.body")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => void handleResend()}
            disabled={sending}
            className="btn btn-primary w-full py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {sending ? t("notifications.emailVerification.modal.resending") : t("notifications.emailVerification.modal.resend")}
          </button>
          <button
            onClick={() => setVisible(false)}
            className="btn btn-ghost w-full py-2.5 rounded-lg text-sm"
          >
            {t("common.action.close")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
