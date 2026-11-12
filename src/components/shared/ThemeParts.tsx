import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { InstallButton } from "@/components/shared/InstallButton";
import type { ThemePreviewPalette } from "@/themes/marketplaceThemes";

type TerminalColors = ThemePreviewPalette["terminal"];
type UiColors = ThemePreviewPalette["ui"];

const NEUTRAL_TERMINAL: TerminalColors = {
  background: "var(--t-bg-card)", foreground: "var(--t-text-dim)", green: "var(--t-border-hover)",
  blue: "var(--t-border)", yellow: "var(--t-border)", cyan: "var(--t-border)",
};

const NEUTRAL_UI: UiColors = {
  bgTerminal: "var(--t-bg-card)", accent: "var(--t-border-hover)", tabActiveText: "var(--t-border)", statusConnected: "var(--t-border)",
};

export function ThemeTerminalPreview({ colors }: { colors: TerminalColors | null }) {
  const c = colors ?? NEUTRAL_TERMINAL;
  return (
    <div
      style={{
        width: 72, height: 52, borderRadius: 6, flexShrink: 0,
        background: c.background,
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "7px 8px",
        display: "flex", flexDirection: "column", gap: 4,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: 3 }}>
        <div style={{ height: 5, borderRadius: 2, background: c.green, flex: 3 }} />
        <div style={{ height: 5, borderRadius: 2, background: c.blue, flex: 2 }} />
      </div>
      <div style={{ height: 4, borderRadius: 2, background: c.yellow, width: "70%" }} />
      <div style={{ height: 4, borderRadius: 2, background: c.cyan, width: "55%" }} />
      <div style={{ height: 4, borderRadius: 2, background: c.foreground, width: "80%", opacity: 0.3 }} />
    </div>
  );
}

export function ThemeCardSwatches({ colors }: { colors: UiColors | null }) {
  const c = colors ?? NEUTRAL_UI;
  return (
    <div className="flex gap-1.5">
      {[c.bgTerminal, c.accent, c.tabActiveText, c.statusConnected].map((color, i) => (
        <span key={i} className="w-5 h-5 rounded-md shrink-0" style={{ background: color, border: "1px solid rgba(255,255,255,0.08)" }} />
      ))}
    </div>
  );
}

export function ThemeGetButton({ busy, disabledReason, onClick }: {
  busy: boolean;
  disabledReason: string | null;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return <InstallButton compact label={t("settings.appearance.marketplace.get")} busy={busy} disabledReason={disabledReason} onClick={onClick} />;
}

export function MarketplaceSourceBadge({ sourceName }: { sourceName: string | null }) {
  const { t } = useTranslation();
  if (sourceName === null) return null;
  return <span className="text-[11px] truncate text-(--t-text-dim)">{t("settings.appearance.marketplace.fromSource", { source: sourceName })}</span>;
}

export function MarketplaceThemeStatus({ loading, unreachableCount }: { loading: boolean; unreachableCount: number }) {
  const { t } = useTranslation();
  if (!loading && unreachableCount === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-(--t-text-dim)">
      {loading && (
        <span className="flex items-center gap-1.5">
          <Icon icon="lucide:loader" width={12} className="animate-spin" />
          {t("settings.appearance.marketplace.loading")}
        </span>
      )}
      {unreachableCount > 0 && (
        <span className="flex items-center gap-1.5 opacity-70">
          <Icon icon="lucide:cloud-off" width={12} />
          {t("settings.appearance.marketplace.unreachable", { count: unreachableCount })}
        </span>
      )}
    </div>
  );
}

export function BrowseMarketplaceThemesButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useTranslation();
  const label = t("settings.appearance.marketplace.browseAll");
  return (
    <button type="button" aria-label={label} onClick={onClick} className={`flex items-center gap-1.5 text-xs font-medium text-(--t-accent) hover:underline ${className ?? ""}`}>
      {label}
      <Icon icon="lucide:arrow-up-right" width={12} />
    </button>
  );
}
