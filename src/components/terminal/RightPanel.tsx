import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useUIStore, RIGHT_PANEL_WIDTH, type RightPanelSection } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { usePluginStore } from "@/stores/pluginStore";
import { SnippetsPanel } from "@/components/terminal/SnippetsPanel";
import { PortsPanel } from "@/components/terminal/PortsPanel";
import { HistoryPanel } from "@/components/terminal/HistoryPanel";
import PanelSftpSection from "@/components/terminal/PanelSftpSection";
import { NotesPanel } from "@/components/terminal/NotesPanel";
import { useThemeStore } from "@/stores/themeStore";
import { useInstalledThemes } from "@/hooks/useInstalledThemes";
import { useMarketplaceThemes } from "@/hooks/useMarketplaceThemes";
import { openMarketplaceThemes, paletteOf } from "@/themes/marketplaceThemes";
import {
  BrowseMarketplaceThemesButton, MarketplaceSourceBadge, MarketplaceThemeStatus, ThemeGetButton, ThemeTerminalPreview,
} from "@/components/shared/ThemeParts";
import { useCurrentSessionTunnelCount } from "@/hooks/useCurrentSessionTunnelCount";
import { useActiveHostConnection } from "@/hooks/useActiveHostConnection";
import { SidePanelColumn, sidePanelWidthStyles } from "@/components/layout/SidePanelColumn";
import { pluginSectionIdOf, useTerminalPanels } from "./terminalPanels";

const PANEL_GUTTER = 16;

// ─── Themes section ───────────────────────────────────────────────────────────

function ThemesSection() {
  const { t } = useTranslation();
  const { activeThemeId, setTheme, getActiveTheme } = useThemeStore();
  const openThemeCreator = useUIStore((s) => s.openThemeCreator);
  const allThemes = useInstalledThemes();
  const marketplace = useMarketplaceThemes();
  const pluginThemes = usePluginStore((s) => s.pluginThemes);

  return (
    <div className="flex flex-col h-full">
      {/* Font row */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors border-b border-b-(--t-border)"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div className="flex items-center gap-3">
          <Icon icon="lucide:type" width={15} className="text-(--t-text-muted)" />
          <div>
            <p className="text-sm font-medium text-(--t-text-primary)">{t("terminal.rightPanel.font")}</p>
            <p className="text-xs text-(--t-text-muted)">
              {getActiveTheme().terminalFontFamily.split(",")[0].replace(/'/g, "")} · {getActiveTheme().terminalFontSize}px
            </p>
          </div>
        </div>
        <Icon icon="lucide:chevron-right" width={14} className="text-(--t-text-dim)" />
      </div>

      <div className="px-4 pt-4 pb-2 shrink-0">
        <p className="text-sm font-medium text-(--t-text-bright)">{t("terminal.rightPanel.themes")}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allThemes.map((theme) => {
          const isActive = theme.id === activeThemeId;
          const removal = marketplace.removal(theme);
          const removalLabel = removal?.kind === "uninstall" ? t("settings.appearance.marketplace.remove") : t("common.action.delete");
          return (
            <div
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-b-(--t-border)"
              style={{ background: isActive ? "var(--t-bg-elevated)" : "transparent" }}
              onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "var(--t-bg-card)"; }}
              onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <div className="relative">
                <ThemeTerminalPreview colors={paletteOf(theme).terminal} />
                {isActive && (
                  <div style={{ position: "absolute", inset: 0, borderRadius: 6, border: `2px solid ${theme.ui.tabActiveText}`, pointerEvents: "none" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: isActive ? theme.ui.tabActiveText : "var(--t-text-primary)" }}>
                  {theme.name}
                </p>
                <p className="text-xs mt-0.5 text-(--t-text-muted)">
                  {isActive ? t("terminal.rightPanel.themeActive")
                    : pluginThemes.has(theme.id) ? t("settings.appearance.marketplace.installedLabel")
                    : theme.builtIn ? t("terminal.rightPanel.themeBuiltin") : t("terminal.rightPanel.themeCustom")}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!theme.builtIn && (
                  <button
                    onClick={(e) => { e.stopPropagation(); openThemeCreator(theme.id); }}
                    className="p-1.5 rounded-sm transition-colors text-(--t-text-muted)"
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
                    title={t("common.action.edit")}
                  >
                    <Icon icon="lucide:pencil" width={12} />
                  </button>
                )}
                {removal && (
                  <button
                    aria-label={removalLabel}
                    title={removal.disabledReason ?? removalLabel}
                    disabled={removal.disabledReason !== null}
                    onClick={(e) => { e.stopPropagation(); removal.remove(); }}
                    className="p-1.5 rounded-sm transition-colors text-(--t-text-muted) enabled:hover:text-(--t-status-error) disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon icon="lucide:trash-2" width={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <button
          onClick={() => openThemeCreator()}
          className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-(--t-accent)"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon icon="lucide:circle-plus" width={15} />
          <span className="text-sm font-medium">{t("terminal.rightPanel.createNewTheme")}</span>
        </button>

        {marketplace.available.length > 0 && (
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm font-medium text-(--t-text-bright)">{t("settings.appearance.marketplace.available")}</p>
          </div>
        )}
        {marketplace.available.map((item) => (
          <div
            key={item.entry.id}
            data-theme-available={item.entry.id}
            className="flex items-center gap-3 px-4 py-3 border-b border-b-(--t-border)"
          >
            <ThemeTerminalPreview colors={item.preview?.terminal ?? null} />
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <p className="text-sm font-medium truncate text-(--t-text-primary)">{item.entry.name}</p>
              <div className="flex items-center gap-1.5 min-w-0">
                <ThemeGetButton busy={marketplace.busy.has(item.entry.id)} disabledReason={item.disabledReason} onClick={() => marketplace.get(item)} />
                <MarketplaceSourceBadge sourceName={item.sourceName} />
              </div>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-2 px-4 py-3">
          <MarketplaceThemeStatus loading={marketplace.loading} unreachableCount={marketplace.unreachableCount} />
          <BrowseMarketplaceThemesButton onClick={openMarketplaceThemes} />
        </div>
      </div>
      {marketplace.modal}
    </div>
  );
}

/** Shown when a persisted `plugin:*` selection no longer resolves to a registered
 *  section — the plugin was uninstalled or disabled while it was the open tab. */
function UnavailablePluginSection() {
  const { t } = useTranslation();
  const setRightPanelSection = useUIStore((s) => s.setRightPanelSection);
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon icon="lucide:puzzle" width={22} className="text-(--t-text-muted)" />
      <p className="text-xs text-(--t-text-secondary)">
        {t("terminal.rightPanel.pluginUnavailable")}
      </p>
      <button
        onClick={() => setRightPanelSection("themes")}
        className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs font-medium"
      >
        {t("terminal.rightPanel.pluginUnavailableAction")}
      </button>
    </div>
  );
}

/** The content of one terminal side panel, on desktop and on phones. `onInjected` runs after
 *  a panel types a command into the session. */
export function TerminalPanelBody({ section, onInjected }: { section: RightPanelSection; onInjected?: () => void }) {
  const pluginSections = usePluginStore((s) => s.rightPanelSections);
  switch (section) {
    case "snippets": return <SnippetsPanel />;
    case "history": return <HistoryPanel onInjected={onInjected} />;
    case "notes": return <NotesPanel />;
    case "themes": return <ThemesSection />;
    case "ports": return <PortsPanel />;
    case "sftp": return <PanelSftpSection />;
  }
  const pluginId = pluginSectionIdOf(section);
  if (pluginId === null) return null;
  const plugin = pluginSections.get(pluginId);
  // The selection is persisted, so it outlives the plugin that registered it.
  if (!plugin) return <UnavailablePluginSection />;
  const Component = plugin.component;
  return <Component />;
}

// ─── Main RightPanel ──────────────────────────────────────────────────────────

function PanelContent() {
  const { t } = useTranslation();
  const rightPanelSection = useUIStore((s) => s.rightPanelSection);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const tunnelCount = useCurrentSessionTunnelCount();
  const hasNotes = !!useActiveHostConnection().connection?.notes?.trim();
  const allSections = useTerminalPanels();

  return (
    <div className="flex flex-row h-full">
      {/* Vertical tab rail */}
      <div className="flex flex-col items-center py-2 gap-1 shrink-0 border-r border-r-(--t-border)" style={{ width: 40 }}>
        <div className="flex flex-col items-center gap-1 flex-1">
          {allSections.map((s) => {
            const isActive = rightPanelSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => toggleRightPanel(s.id)}
                className="relative w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                style={{
                  background: isActive ? "var(--t-tab-active-bg)" : "transparent",
                  color: isActive ? "var(--t-tab-active-text)" : "var(--t-text-muted)",
                }}
                title={s.title}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
              >
                <Icon icon={s.icon} width={15} />
                {s.id === "ports" && tunnelCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-0.5 flex items-center justify-center
                      rounded-full text-[9px] font-semibold leading-none"
                    style={{ background: "var(--t-accent)", color: "var(--t-on-accent)" }}
                  >
                    {tunnelCount}
                  </span>
                )}
                {s.id === "notes" && hasNotes && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--t-accent)" }} />
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => toggleRightPanel()}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-(--t-text-muted)"
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
          title={t("terminal.rightPanel.closePanelTitle")}
        >
          <Icon icon="lucide:x" width={13} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <TerminalPanelBody section={rightPanelSection} />
      </div>
    </div>
  );
}

export default function RightPanel() {
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const activeNav = useUIStore((s) => s.activeNav);
  const panelWidth = useUIStore((s) => s.rightPanelWidth);
  const setPanelWidth = useUIStore((s) => s.setRightPanelWidth);
  const hasActiveSession = useSessionStore((s) => s.activeSessionId !== null && s.sessions.length > 0);
  const { t } = useTranslation();

  const isTerminalView = hasActiveSession && activeNav !== "hosts";

  if (!isTerminalView) return null;

  return (
    <SidePanelColumn
      testId="right-panel"
      open={rightPanelOpen}
      side="right"
      {...sidePanelWidthStyles(panelWidth, PANEL_GUTTER)}
      resize={{
        min: RIGHT_PANEL_WIDTH.min,
        max: RIGHT_PANEL_WIDTH.max,
        defaultWidth: RIGHT_PANEL_WIDTH.default,
        onChange: setPanelWidth,
        label: t("terminal.rightPanel.resizeHandle"),
      }}
    >
      <PanelContent />
    </SidePanelColumn>
  );
}
