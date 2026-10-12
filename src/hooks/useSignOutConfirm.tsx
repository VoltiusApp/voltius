import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { logout } from "@/services/account";
import { getSyncState, isSyncPaused } from "@/services/sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { signOutRisk, type SignOutRisk } from "@/utils/signOutRisk";

const MESSAGE_KEY: Record<SignOutRisk, string> = {
  "no-server-copy": "shared.signOutConfirm.noServerCopy",
  unsynced: "shared.signOutConfirm.unsynced",
};

export function useSignOutConfirm(onError: (e: unknown) => void = () => {}): {
  requestSignOut: () => void;
  signOutConfirm: ReactNode;
} {
  const { t } = useTranslation();
  const [risk, setRisk] = useState<SignOutRisk | null>(null);

  const signOut = () => {
    logout()
      .then(() => window.location.reload())
      .catch(onError);
  };

  const requestSignOut = () => {
    const found = signOutRisk({
      isPro: useSubscriptionStore.getState().isPro,
      paused: isSyncPaused(),
      status: getSyncState().status,
    });
    if (found) setRisk(found);
    else signOut();
  };

  const signOutConfirm = risk && (
    <ConfirmModal
      title={t("shared.signOutConfirm.title")}
      message={t(MESSAGE_KEY[risk])}
      confirmLabel={t("shared.signOutConfirm.confirm")}
      onConfirm={() => { setRisk(null); signOut(); }}
      onCancel={() => setRisk(null)}
    />
  );

  return { requestSignOut, signOutConfirm };
}
