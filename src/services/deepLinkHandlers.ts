import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { refreshSession } from "@/services/account";
import { getSavedAccounts, switchToAccount, type SavedAccount } from "@/services/savedAccounts";
import type { SilentIntent, VerifiedIntent } from "@/services/deepLinkUrl";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { parseJwtPayload } from "@/utils/emailVerification";
import type { ToastSeverity } from "@/plugins/api";

const SOURCE = { kind: "plugin", id: "system", name: "Voltius" } as const;

function toast(
  message: string,
  severity: ToastSeverity,
  action?: { label: string; onClick: () => void },
): void {
  useNotificationStore.getState().addToast({
    source: SOURCE,
    type: "toast",
    message,
    severity,
    duration: severity === "error" ? 5000 : 3500,
    action,
  });
}

function jwtSubject(jwt: string | null): string | null {
  if (!jwt) return null;
  return parseJwtPayload<{ sub?: string }>(jwt)?.sub ?? null;
}

async function handleVerified(intent: VerifiedIntent): Promise<void> {
  const activeJwt = await invoke<string | null>("keychain_get", { key: "jwt" });
  if (jwtSubject(activeJwt) === intent.userId) {
    try {
      await refreshSession();
      await useSubscriptionStore.getState().load();
      toast(i18n.t("notifications.emailVerification.toast.verified"), "success");
    } catch {
      toast(i18n.t("notifications.emailVerification.toast.refreshFailed"), "error");
    }
    return;
  }

  const saved: SavedAccount[] = await getSavedAccounts().catch(() => []);
  const match = saved.find((account) => jwtSubject(account.jwt) === intent.userId);
  if (!match) {
    // Also the not-signed-in case: the splash screen resolves whether or not a
    // session exists, so a link can land while the auth screen is up.
    toast(i18n.t("notifications.emailVerification.toast.verifiedUnknown"), "success");
    return;
  }

  toast(
    i18n.t("notifications.emailVerification.toast.verifiedOther", { email: match.email ?? "" }),
    "success",
    {
      label: i18n.t("notifications.emailVerification.toast.verifiedSwitch"),
      // switchToAccount saves the outgoing account and reloads the window.
      onClick: () => void switchToAccount(match),
    },
  );
}

/**
 * Silent routes act unprompted, so every failure path here has to end in a
 * toast rather than a rejected promise: the caller is an event listener.
 */
export function handleSilentIntent(intent: SilentIntent): void {
  switch (intent.route) {
    case "verified":
      void handleVerified(intent);
      return;
  }
}
