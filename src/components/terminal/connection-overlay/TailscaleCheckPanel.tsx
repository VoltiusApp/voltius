import { useState } from "react";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { logFailure } from "@/lib/logger";
import { writeClipboard } from "@/utils/clipboard";
import { DecisionPanel } from "./DecisionPanel";

export function TailscaleCheckPanel({ url, onCancel }: { url: string; onCancel?: () => void }) {
  const { t } = useTranslation();
  const [browserFailed, setBrowserFailed] = useState(false);
  const { copied, flash } = useCopiedFlash(2000);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:shield-check" width={14} className="text-(--t-text-dim) shrink-0" />}
      title={t("terminal.overlay.tailscaleCheck.title")}
      description={t("terminal.overlay.tailscaleCheck.description")}
      actions={[
        {
          label: t("terminal.overlay.tailscaleCheck.open"),
          onClick: () => void openUrl(url).catch(() => setBrowserFailed(true)),
        },
        {
          label: t(copied ? "terminal.overlay.tailscaleCheck.copied" : "terminal.overlay.tailscaleCheck.copy"),
          variant: "secondary",
          onClick: () => void writeClipboard(url).then(() => flash(), logFailure("copy Tailscale check link")),
        },
        ...(onCancel
          ? [{ label: t("common.action.cancel"), variant: "ghost" as const, dismisses: true, onClick: onCancel }]
          : []),
      ]}
    >
      <p className="w-full select-all break-all text-left font-mono text-xs text-(--t-text-secondary)">{url}</p>
      {browserFailed && (
        <p role="alert" className="w-full text-left text-xs text-(--t-status-error)">
          {t("terminal.overlay.tailscaleCheck.manual")}
        </p>
      )}
    </DecisionPanel>
  );
}
