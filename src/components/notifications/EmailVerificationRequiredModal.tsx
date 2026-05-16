import { useEffect, useState } from "react";
import { Modal } from "@/components/shared/Modal";
import { resendVerificationEmail } from "@/services/account";
import { EMAIL_VERIFICATION_REQUIRED_EVENT } from "@/services/billingCheckout";
import { useNotificationStore } from "@/stores/notificationStore";

export function EmailVerificationRequiredModal() {
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
        pluginId: "system",
        pluginName: "Voltius",
        type: "toast",
        message: "Verification email sent.",
        severity: "success",
        duration: 3500,
      });
    } catch (e) {
      addToast({
        pluginId: "system",
        pluginName: "Voltius",
        type: "toast",
        message: e instanceof Error ? e.message : "Could not resend verification email.",
        severity: "error",
        duration: 5000,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal onClose={() => setVisible(false)} blur>
      <div
        className="flex flex-col gap-4 animate-fadeIn bg-[var(--t-bg-base)] border border-[var(--t-border)] p-8"
        style={{
          width: "min(28rem, 92vw)",
          borderRadius: "0.933rem",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div>
          <p className="text-base font-semibold text-[var(--t-text-primary)] mb-1">
            Verify your email first
          </p>
          <p className="text-sm text-[var(--t-text-muted)] leading-relaxed">
            Cloud upgrades require a verified email address. Check your inbox for the verification link, or send a new one.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => void handleResend()}
            disabled={sending}
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--t-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {sending ? "Sending..." : "Resend email"}
          </button>
          <button
            onClick={() => setVisible(false)}
            className="w-full py-2.5 rounded-lg text-sm text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
