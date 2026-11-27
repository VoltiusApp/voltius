import { useState } from "react";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useCopyText } from "@/hooks/useCopyText";
import { DecisionPanel } from "./DecisionPanel";

export function BrowserCheckPanel({ kind, url, code, onCancel }: {
  kind: "tailscaleCheck" | "netbird";
  url: string;
  code?: string;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [browserFailed, setBrowserFailed] = useState(false);
  const { copied, copy } = useCopyText();
  const text = (key: string) => t(`terminal.overlay.${kind}.${key}`);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:shield-check" width={14} className="text-(--t-text-dim) shrink-0" />}
      title={text("title")}
      description={text("description")}
      actions={[
        {
          label: text("open"),
          onClick: () => void openUrl(url).catch(() => setBrowserFailed(true)),
        },
        {
          label: text(copied ? "copied" : "copy"),
          variant: "secondary",
          onClick: () => copy(url),
        },
        ...(onCancel
          ? [{ label: t("common.action.cancel"), variant: "ghost" as const, dismisses: true, onClick: onCancel }]
          : []),
      ]}
    >
      {code && <p className="w-full select-all break-all text-center font-mono text-lg text-(--t-text-primary)">{code}</p>}
      <p className="w-full select-all break-all text-left font-mono text-xs text-(--t-text-secondary)">{url}</p>
      {browserFailed && (
        <p role="alert" className="w-full text-left text-xs text-(--t-status-error)">
          {text("manual")}
        </p>
      )}
    </DecisionPanel>
  );
}
