import { useState } from "react";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useCopyText } from "@/hooks/useCopyText";
import type { NetbirdChallenge } from "@/types";
import { DecisionPanel } from "./DecisionPanel";

export function SshVerificationPanel({ url, netbird, onCancel }: {
  url: string;
  netbird?: NetbirdChallenge;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [browserFailed, setBrowserFailed] = useState(false);
  const { copied, copy } = useCopyText();

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:shield-check" width={14} className="text-(--t-text-dim) shrink-0" />}
      title={netbird ? "NetBird SSH" : t("terminal.overlay.tailscaleCheck.title")}
      description={t(netbird ? "terminal.overlay.netbird.verify" : "terminal.overlay.tailscaleCheck.description")}
      actions={[
        {
          label: t(netbird ? "terminal.overlay.netbird.open" : "terminal.overlay.tailscaleCheck.open"),
          onClick: () => void openUrl(url).catch(() => setBrowserFailed(true)),
        },
        {
          label: t(copied ? "terminal.overlay.tailscaleCheck.copied" : "terminal.overlay.tailscaleCheck.copy"),
          variant: "secondary",
          onClick: () => copy(url),
        },
        ...(onCancel
          ? [{ label: t("common.action.cancel"), variant: "ghost" as const, dismisses: true, onClick: onCancel }]
          : []),
      ]}
    >
      {netbird && <p className="select-all break-all font-mono">{netbird.userCode}</p>}
      <p className="w-full select-all break-all text-left font-mono text-xs text-(--t-text-secondary)">{url}</p>
      {browserFailed && (
        <p role="alert" className="w-full text-left text-xs text-(--t-status-error)">
          {t(netbird ? "terminal.overlay.netbird.manual" : "terminal.overlay.tailscaleCheck.manual")}
        </p>
      )}
    </DecisionPanel>
  );
}
