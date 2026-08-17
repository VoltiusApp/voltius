import i18n from "@/i18n";
import { refreshVerificationState } from "@/services/account";
import { getJwt } from "@/services/authTokens";
import { getSavedAccounts, switchToAccount, type SavedAccount } from "@/services/savedAccounts";
import type { SilentIntent, VerifiedIntent } from "@/services/deepLinkUrl";
import { useNotificationStore } from "@/stores/notificationStore";
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
    // An action is the only affordance for its branch, and a history row keeps
    // none, so an actionable toast stays until dismissed.
    duration: action ? 0 : severity === "error" ? 5000 : 3500,
    action,
  });
}

function jwtSubject(jwt: string | null): string | null {
  if (!jwt) return null;
  return parseJwtPayload<{ sub?: string }>(jwt)?.sub ?? null;
}

async function handleVerified(intent: VerifiedIntent): Promise<void> {
  const activeJwt = await getJwt().catch(() => null);
  if (jwtSubject(activeJwt) === intent.userId) {
    try {
      const verified = await refreshVerificationState();
      if (verified) toast(i18n.t("notifications.emailVerification.toast.verified"), "success");
      else toast(i18n.t("notifications.emailVerification.toast.verifiedPending"), "warning");
    } catch {
      toast(i18n.t("notifications.emailVerification.toast.refreshFailed"), "error");
    }
    return;
  }

  const saved: SavedAccount[] = await getSavedAccounts();
  const match = saved.find((account) => jwtSubject(account.jwt) === intent.userId);
  if (!match) {
    // Not the signed-out case: a link arriving at the auth screen is queued and
    // fires after sign-in, so this user is genuinely unknown to this device.
    toast(i18n.t("notifications.emailVerification.toast.verifiedUnknown"), "success");
    return;
  }

  toast(
    match.email
      ? i18n.t("notifications.emailVerification.toast.verifiedOther", { email: match.email })
      : i18n.t("notifications.emailVerification.toast.verified"),
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
    // On the route rather than the intent: TypeScript only narrows the object
    // itself to `never` once the union has two or more members.
    default: {
      const _exhaustive: never = intent.route;
      void _exhaustive;
    }
  }
}
