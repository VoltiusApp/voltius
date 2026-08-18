import i18n from "@/i18n";
import { refreshVerificationState } from "@/services/account";
import { getJwt } from "@/services/authTokens";
import { getSavedAccounts, switchToAccount, type SavedAccount } from "@/services/savedAccounts";
import { isNavigateIntent } from "@/services/deepLinkUrl";
import type { NavigateIntent, UnpromptedIntent, VerifiedIntent } from "@/services/deepLinkUrl";
import { useUIStore } from "@/stores/uiStore";
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
 * Navigate routes only move the user somewhere they could already go, so none
 * of these branches performs an action: `billing` opens the account section
 * rather than starting a checkout, and an unknown notification id opens the
 * centre on the full list.
 */
function handleNavigate(intent: NavigateIntent): void {
  const ui = useUIStore.getState();
  switch (intent.route) {
    case "notification":
      ui.openNotificationCenter(intent.entryId);
      return;
    case "settings":
      ui.openSettings(intent.section);
      return;
    case "billing":
      ui.openSettings("account");
      return;
    default: {
      const _exhaustive: never = intent;
      void _exhaustive;
    }
  }
}

/**
 * Unprompted routes act without asking, so every failure path here has to end
 * in a toast rather than a rejected promise: the caller is an event listener.
 */
export function handleUnpromptedIntent(intent: UnpromptedIntent): void {
  // Routed by trust class rather than by a second list of route names, so
  // adding a navigate route means touching `TRUST` and `handleNavigate` only.
  if (isNavigateIntent(intent)) {
    handleNavigate(intent);
    return;
  }
  switch (intent.route) {
    case "verified":
      void handleVerified(intent);
      return;
    default: {
      const _exhaustive: never = intent;
      void _exhaustive;
    }
  }
}
