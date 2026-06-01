import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useUIStore, type RightPanelSection } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { usePluginStore } from "@/stores/pluginStore";
import { SnippetsPanel } from "@/components/terminal/SnippetsPanel";
import { PortsPanel } from "@/components/terminal/PortsPanel";
import { HistoryPanel } from "@/components/terminal/HistoryPanel";
import PanelSftpSection from "@/components/terminal/PanelSftpSection";
import { useThemeStore } from "@/stores/themeStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import type { AppTheme } from "@/themes/types";

const PANEL_WIDTH = 300;
const TRANSITION = "width 180ms cubic-bezier(0.4, 0, 0.2, 1)";

// ─── Theme preview thumbnail ──────────────────────────────────────────────────

function ThemePreview({ theme }: { theme: AppTheme }) {
  const t = theme.terminal;
  return (
    <div
      style={{
        width: 72, height: 52, borderRadius: 6, flexShrink: 0,
        background: t.background,
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "7px 8px",
        display: "flex", flexDirection: "column", gap: 4,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: 3 }}>
        <div style={{ height: 5, borderRadius: 2, background: t.green, flex: 3 }} />
        <div style={{ height: 5, borderRadius: 2, background: t.blue, flex: 2 }} />
      </div>
      <div style={{ height: 4, borderRadius: 2, background: t.yellow, width: "70%" }} />
      <div style={{ height: 4, borderRadius: 2, background: t.cyan, width: "55%" }} />
      <div style={{ height: 4, borderRadius: 2, background: t.foreground, width: "80%", opacity: 0.3 }} />
    </div>
  );
}

// ─── Themes section ───────────────────────────────────────────────────────────

function ThemesSection() {
  const { activeThemeId, customThemes, setTheme, deleteCustomTheme, getActiveTheme } = useThemeStore();
  const openThemeCreator = useUIStore((s) => s.openThemeCreator);
  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  return (
    <div className="flex flex-col h-full">
      {/* Font row */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors border-b border-b-[var(--t-border)]"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div className="flex items-center gap-3">
          <Icon icon="lucide:type" width={15} className="text-[var(--t-text-muted)]" />
          <div>
            <p className="text-sm font-medium text-[var(--t-text-primary)]">Font</p>
            <p className="text-xs text-[var(--t-text-muted)]">
              {getActiveTheme().terminalFontFamily.split(",")[0].replace(/'/g, "")} · {getActiveTheme().terminalFontSize}px
            </p>
          </div>
        </div>
        <Icon icon="lucide:chevron-right" width={14} className="text-[var(--t-text-dim)]" />
      </div>

      <div className="px-4 pt-4 pb-2 shrink-0">
        <p className="text-sm font-medium text-[var(--t-text-bright)]">Themes</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allThemes.map((theme) => {
          const isActive = theme.id === activeThemeId;
          return (
            <div
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-b-[var(--t-border)]"
              style={{ background: isActive ? "var(--t-bg-elevated)" : "transparent" }}
              onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "var(--t-bg-card)"; }}
              onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <div className="relative">
                <ThemePreview theme={theme} />
                {isActive && (
                  <div style={{ position: "absolute", inset: 0, borderRadius: 6, border: `2px solid ${theme.ui.tabActiveText}`, pointerEvents: "none" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: isActive ? theme.ui.tabActiveText : "var(--t-text-primary)" }}>
                  {theme.name}
                </p>
                <p className="text-xs mt-0.5 text-[var(--t-text-muted)]">
                  {isActive ? "∞ active" : theme.builtIn ? "built-in" : "custom"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!theme.builtIn && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); openThemeCreator(theme.id); }}
                      className="p-1.5 rounded transition-colors text-[var(--t-text-muted)]"
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
                      title="Edit"
                    >
                      <Icon icon="lucide:pencil" width={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCustomTheme(theme.id); if (activeThemeId === theme.id) setTheme("abyss"); }}
                      className="p-1.5 rounded transition-colors text-[var(--t-text-muted)]"
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
                      title="Delete"
                    >
                      <Icon icon="lucide:trash-2" width={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        <button
          onClick={() => openThemeCreator()}
          className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-[var(--t-accent)]"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon icon="lucide:plus-circle" width={15} />
          <span className="text-sm font-medium">Create New Theme</span>
        </button>
      </div>
    </div>
  );
}

// ─── Main RightPanel ──────────────────────────────────────────────────────────

const BUILTIN_SECTIONS: { id: RightPanelSection; icon: string; title: string }[] = [
  { id: "snippets", icon: "lucide:braces",      title: "Snippets" },
  { id: "history",  icon: "lucide:clock",       title: "History"  },
  { id: "themes",   icon: "lucide:palette",     title: "Themes"   },
  { id: "ports",    icon: "lucide:network",     title: "Ports"    },
  { id: "sftp",     icon: "lucide:folder-tree", title: "SFTP"     },
];

function PanelContent() {
  const rightPanelSection = useUIStore((s) => s.rightPanelSection);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const pluginSections = usePluginStore((s) => s.rightPanelSections);

  const allSections = useMemo(() => [
    ...BUILTIN_SECTIONS,
    ...[...pluginSections.values()].map((s) => ({
      id: `plugin:${s.id}` as RightPanelSection,
      icon: s.icon ?? "lucide:puzzle",
      title: s.label,
    })),
  ], [pluginSections]);

  return (
    <div className="flex flex-row h-full">
      {/* Vertical tab rail */}
      <div className="flex flex-col items-center py-2 gap-1 shrink-0 border-r border-r-[var(--t-border)]" style={{ width: 40 }}>
        <div className="flex flex-col items-center gap-1 flex-1">
          {allSections.map((s) => {
            const isActive = rightPanelSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => toggleRightPanel(s.id)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                style={{
                  background: isActive ? "var(--t-tab-active-bg)" : "transparent",
                  color: isActive ? "var(--t-tab-active-text)" : "var(--t-text-muted)",
                }}
                title={s.title}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
              >
                <Icon icon={s.icon} width={15} />
              </button>
            );
          })}
        </div>
        <button
          onClick={() => toggleRightPanel()}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-[var(--t-text-muted)]"
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
          title="Close panel"
        >
          <Icon icon="lucide:x" width={13} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {rightPanelSection === "snippets" && <SnippetsPanel />}
        {rightPanelSection === "history"  && <HistoryPanel />}
        {rightPanelSection === "themes"   && <ThemesSection />}
        {rightPanelSection === "ports"    && <PortsPanel />}
        {rightPanelSection === "sftp"     && <PanelSftpSection />}
        {rightPanelSection?.startsWith("plugin:") && (() => {
          const pluginId = rightPanelSection.slice("plugin:".length);
          const section = pluginSections.get(pluginId);
          if (!section) return null;
          const Component = section.component;
          return <Component />;
        })()}
      </div>
    </div>
  );
}

export default function RightPanel() {
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const activeNav = useUIStore((s) => s.activeNav);
  const { sessions, activeSessionId } = useSessionStore();

  const hasActiveSession = activeSessionId !== null && sessions.length > 0;
  const isTerminalView = hasActiveSession && activeNav !== "hosts";

  if (!isTerminalView) return null;

  return (
    <div className="relative shrink-0 overflow-hidden bg-[var(--t-bg-terminal)]" style={{ width: rightPanelOpen ? PANEL_WIDTH + 16 : 0, transition: TRANSITION }}>
      {rightPanelOpen && (
        <aside
          className="flex flex-col absolute inset-y-2 right-2 bg-[var(--t-bg-modal)] border border-[var(--t-border)] overflow-hidden rounded-[0.8rem]"
          style={{
            width: "20rem",
          }}
        >
          <PanelContent />
        </aside>
      )}
    </div>
  );
}
