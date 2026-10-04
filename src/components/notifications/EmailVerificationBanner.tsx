import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { EMAIL_CHANGED_EVENT, getCurrentUserEmail, getMe, refreshVerificationState, resendVerificationEmail } from "@/services/account";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { EmailUndeliverableError } from "@/utils/emailVerification";

export function EmailVerificationBanner() {
  const { t } = useTranslation();
  const { accountMode, emailVerified } = useSubscriptionStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [email, setEmail] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [resending, setResending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [undeliverable, setUndeliverable] = useState(false);

  useEffect(() => {
    if (accountMode !== "server" || emailVerified) return;
    const load = () => {
      getCurrentUserEmail().then(setEmail).catch(() => setEmail(null));
      void getMe().then((me) => setUndeliverable(me?.email_undeliverable === true));
    };
    load();
    window.addEventListener(EMAIL_CHANGED_EVENT, load);
    return () => window.removeEventListener(EMAIL_CHANGED_EVENT, load);
  }, [accountMode, emailVerified]);

  if (accountMode !== "server" || emailVerified || dismissed) return null;

  async function handleResend() {
    setResending(true);
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
      if (e instanceof EmailUndeliverableError) setUndeliverable(true);
      addToast({
        source: { kind: "plugin", id: "system", name: "Voltius" },
        type: "toast",
        message: e instanceof Error ? e.message : t("notifications.emailVerification.toast.sendFailed"),
        severity: "error",
        duration: 5000,
      });
    } finally {
      setResending(false);
    }
  }

  async function handleVerified() {
    setRefreshing(true);
    try {
      await refreshVerificationState();
    } catch (e) {
      addToast({
        source: { kind: "plugin", id: "system", name: "Voltius" },
        type: "toast",
        message: e instanceof Error ? e.message : t("notifications.emailVerification.toast.refreshFailed"),
        severity: "error",
        duration: 5000,
      });
    } finally {
      setRefreshing(false);
    }
  }

  const displayEmail = email ?? t("notifications.emailVerification.banner.yourEmail");

  return (
    <div className="px-4 py-2 border-b border-(--t-border) bg-(--t-bg-elevated)">
      <div className="flex items-center gap-3 text-sm">
        <Icon icon="lucide:mail-warning" width={16} className="shrink-0 text-(--t-status-warning)" />
        <p className="flex-1 text-(--t-text-primary)">
          {undeliverable
            ? t("notifications.emailVerification.banner.undeliverable", { email: displayEmail })
            : t("notifications.emailVerification.banner.message", { email: displayEmail })}
        </p>
        {undeliverable ? (
          <button
            onClick={() => useUIStore.getState().openSettings("account")}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-(--t-accent) text-white hover:opacity-90 transition-opacity"
          >
            {t("notifications.emailVerification.banner.changeEmail")}
          </button>
        ) : (
          <>
            <button
              onClick={() => void handleResend()}
              disabled={resending}
              className="px-2.5 py-1 rounded-md text-xs font-medium text-(--t-accent) hover:bg-(--t-bg-card) transition-colors disabled:opacity-60"
            >
              {resending ? t("notifications.emailVerification.banner.resending") : t("notifications.emailVerification.banner.resend")}
            </button>
            <button
              onClick={() => void handleVerified()}
              disabled={refreshing}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-(--t-accent) text-white hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {refreshing ? t("notifications.emailVerification.banner.checking") : t("notifications.emailVerification.banner.verified")}
            </button>
          </>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="w-6 h-6 flex items-center justify-center rounded-md text-(--t-text-dim) hover:text-(--t-text-primary) hover:bg-(--t-bg-card) transition-colors"
          aria-label={t("notifications.emailVerification.banner.dismissAriaLabel")}
        >
          <Icon icon="lucide:x" width={14} />
        </button>
      </div>
    </div>
  );
}
