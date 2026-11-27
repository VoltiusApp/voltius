import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useCopyText } from "@/hooks/useCopyText";
import { DecisionPanel } from "./DecisionPanel";

export function BrowserCheckPanel({ kind, url, code, autoOpen, onCancel }: {
  kind: "tailscaleCheck" | "netbird";
  url?: string;
  autoOpen?: boolean;
  code?: string;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [browserFailed, setBrowserFailed] = useState(false);
  const { copied, copy } = useCopyText();
  const text = (key: string) => t(`terminal.overlay.${kind}.${key}`);

  const opened = useRef<string | undefined>(undefined);
  const open = useCallback(() => {
    if (!url) return;
    opened.current = url;
    setBrowserFailed(false);
    void openUrl(url).catch(() => setBrowserFailed(true));
  }, [url]);

  useEffect(() => {
    if (!autoOpen || !url) return;
    const openIfVisible = () => {
      if (document.visibilityState === "visible" && opened.current !== url) open();
    };
    openIfVisible();
    document.addEventListener("visibilitychange", openIfVisible);
    return () => document.removeEventListener("visibilitychange", openIfVisible);
  }, [autoOpen, url, open]);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:shield-check" width={14} className="text-(--t-text-dim) shrink-0" />}
      title={url ? text("title") : "Tailscale SSH"}
      description={url ? text("description") : t("terminal.overlay.steps.authenticating")}
      actions={[
        ...(url ? [
          { label: text("open"), onClick: open },
          { label: text(copied ? "copied" : "copy"), variant: "secondary" as const, onClick: () => copy(url) },
        ] : []),
        ...(onCancel
          ? [{ label: t("common.action.cancel"), variant: "ghost" as const, dismisses: true, onClick: onCancel }]
          : []),
      ]}
    >
      {code && <p className="w-full select-all break-all text-center font-mono text-lg text-(--t-text-primary)">{code}</p>}
      {url && <p className="w-full select-all break-all text-left font-mono text-xs text-(--t-text-secondary)">{url}</p>}
      {browserFailed && (
        <p role="alert" className="w-full text-left text-xs text-(--t-status-error)">
          {text("manual")}
        </p>
      )}
    </DecisionPanel>
  );
}
