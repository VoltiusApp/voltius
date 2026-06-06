import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { getCurrentUserEmail, refreshSession, resendVerificationEmail } from "@/services/account";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

export function EmailVerificationBanner() {
  const { accountMode, emailVerified, load } = useSubscriptionStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [email, setEmail] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [resending, setResending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (accountMode !== "server") return;
    getCurrentUserEmail().then(setEmail).catch(() => setEmail(null));
  }, [accountMode]);

  if (accountMode !== "server" || emailVerified || dismissed) return null;

  async function handleResend() {
    setResending(true);
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
      setResending(false);
    }
  }

  async function handleVerified() {
    setRefreshing(true);
    try {
      await refreshSession();
      await load();
    } catch (e) {
      addToast({
        pluginId: "system",
        pluginName: "Voltius",
        type: "toast",
        message: e instanceof Error ? e.message : "Could not refresh session.",
        severity: "error",
        duration: 5000,
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="px-4 py-2 border-b border-(--t-border) bg-(--t-bg-elevated)">
      <div className="flex items-center gap-3 text-sm">
        <Icon icon="lucide:mail-warning" width={16} className="shrink-0 text-(--t-status-warning)" />
        <p className="flex-1 text-(--t-text-primary)">
          Verify your email to unlock cloud features. We sent a link to {email ?? "your email"}.
        </p>
        <button
          onClick={() => void handleResend()}
          disabled={resending}
          className="px-2.5 py-1 rounded-md text-xs font-medium text-(--t-accent) hover:bg-(--t-bg-card) transition-colors disabled:opacity-60"
        >
          {resending ? "Sending..." : "Resend email"}
        </button>
        <button
          onClick={() => void handleVerified()}
          disabled={refreshing}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-(--t-accent) text-white hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {refreshing ? "Checking..." : "I've verified"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="w-6 h-6 flex items-center justify-center rounded-md text-(--t-text-dim) hover:text-(--t-text-primary) hover:bg-(--t-bg-card) transition-colors"
          aria-label="Dismiss email verification banner"
        >
          <Icon icon="lucide:x" width={14} />
        </button>
      </div>
    </div>
  );
}
