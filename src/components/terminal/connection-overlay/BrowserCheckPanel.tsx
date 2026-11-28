import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useCopyText } from "@/hooks/useCopyText";
import { useDismissBlocked } from "./dismissBlocked";

export function BrowserCheckPanel({ kind, url, banner, code, autoOpen, onCancel }: {
  kind: "tailscaleCheck" | "netbird";
  url?: string;
  banner?: string;
  autoOpen?: boolean;
  code?: string;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const dismissBlocked = useDismissBlocked();
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

  // Only the URL validated by the backend is interactive. All other banner text is literal.
  const words = banner?.split(/(\s+)/);
  const link = url && (
    <a href={url} className="text-(--t-accent) underline" onClick={(event) => { event.preventDefault(); open(); }}>
      {url}
    </a>
  );

  return (
    <div className="ml-8 mt-2 space-y-2 text-left">
      {url && (
        <div className="space-y-2 rounded-lg border border-(--t-border) bg-(--t-bg-elevated) p-3 text-xs">
          <div role="status" className="flex items-center gap-2 font-semibold text-(--t-text-primary)">
            <Icon icon="lucide:shield-check" width={14} />
            {text("title")}
          </div>
          {code && <p className="select-all font-mono text-lg">{code}</p>}
          <p className="select-text whitespace-pre-wrap wrap-anywhere font-mono text-(--t-text-secondary)">
            {words?.map((word, i) => word === url ? <span key={i}>{link}</span> : word) ?? text("description")}
            {!words?.includes(url) && <>{"\n"}{link}</>}
          </p>
        </div>
      )}
      {browserFailed && <p role="alert" className="text-xs text-status-error">{text("manual")}</p>}
      <div className="flex flex-wrap gap-2">
        {url && <>
          <button className="btn btn-primary rounded-lg px-3 py-2 text-xs" onClick={open}>{text("open")}</button>
          <button className="btn btn-secondary rounded-lg px-3 py-2 text-xs" onClick={() => copy(url)}>
            {text(copied ? "copied" : "copy")}
          </button>
        </>}
        {onCancel && (
          <button className="btn btn-ghost rounded-lg px-3 py-2 text-xs" disabled={!!dismissBlocked} title={dismissBlocked} onClick={onCancel}>
            {t("common.action.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
