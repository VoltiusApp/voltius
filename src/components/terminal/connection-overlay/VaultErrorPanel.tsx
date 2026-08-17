import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { VaultErrorCode } from "@/services/vaultErrors";
import { DecisionPanel } from "./DecisionPanel";

/**
 * The host's credentials exist but the vault would not hand them over. Retyping a
 * password the app is already holding fixes nothing, so this offers the unlock
 * screen — which owns every vault recovery choice — instead of an auth prompt.
 */
export function VaultErrorPanel({
  code,
  onRetry,
  onCancel,
}: {
  code: VaultErrorCode;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const locked = code === "vault-locked";

  const actions = [
    {
      label: t("terminal.overlay.vaultError.unlock"),
      variant: "primary" as const,
      onClick: () => window.location.reload(),
    },
    ...(onRetry ? [{ label: t("terminal.overlay.vaultError.retry"), variant: "secondary" as const, onClick: onRetry }] : []),
    ...(onCancel ? [{ label: t("terminal.overlay.vaultError.dismiss"), variant: "ghost" as const, onClick: onCancel }] : []),
  ];

  return (
    <DecisionPanel
      tone="warning"
      icon={<Icon icon={locked ? "lucide:lock" : "lucide:shield-alert"} width={14} className="text-yellow-400" />}
      title={t(locked ? "terminal.overlay.vaultError.lockedTitle" : "terminal.overlay.vaultError.unreadableTitle")}
      description={t(locked ? "terminal.overlay.vaultError.lockedBody" : "terminal.overlay.vaultError.unreadableBody")}
      actions={actions}
    />
  );
}
