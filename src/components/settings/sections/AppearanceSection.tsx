import { Icon } from "@iconify/react";
import { useThemeStore } from "@/stores/themeStore";
import { usePluginStore } from "@/stores/pluginStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { FormSelect } from "@/components/shared/FormSelect";
import { Toggle } from "@/components/shared/Toggle";
import type { AppTheme } from "@/themes/types";
import ScaleSection from "./ScaleSection";
import { DirtyDot, ResetButton } from "./shared";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTheme(theme: AppTheme) {
  downloadJson(
    `${theme.name.toLowerCase().replace(/\s+/g, "-")}.voltius-theme.json`,
    { type: "voltius-theme", version: 1, theme },
  );
}

export default function AppearanceSection() {
  const { activeThemeId, customThemes, setTheme, deleteCustomTheme } = useThemeStore();
  const { openThemeCreator, openThemeImportExport } = useUIStore();
  const pluginThemeMap = usePluginStore((s) => s.pluginThemes);
  const [scrollMinimapEnabled, setScrollMinimapEnabled] = useToggle("scroll-minimap");
  const [selectToCopy, setSelectToCopy] = useToggle("select-to-copy");
  const scrollbackLines = useTerminalSettingsStore((s) => s.scrollbackLines);
  const setScrollbackLines = useTerminalSettingsStore((s) => s.setScrollbackLines);

  const pluginThemes: AppTheme[] = [...pluginThemeMap.values()].map((t) => ({ ...t, builtIn: true }));
  const allThemes = [...BUILT_IN_THEMES, ...customThemes, ...pluginThemes];
  const scrollbackOptions = [1_000, 10_000, 50_000, 100_000, 250_000]
    .filter((value) => value >= MIN_SCROLLBACK_LINES && value <= MAX_SCROLLBACK_LINES)
    .map((value) => ({ value: String(value), label: `${value.toLocaleString()} lines` }));

  const handleDelete = (id: string) => {
    deleteCustomTheme(id);
    if (activeThemeId === id) setTheme("abyss");
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-[var(--t-text-dim)]">
          Interface
        </h3>
        <ScaleSection />
        <div className="group mt-4 rounded-xl bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[var(--t-text-primary)]">Terminal scrollback</div>
            <div className="text-xs mt-1 text-[var(--t-text-dim)]">
              Retained lines per terminal session. Applies to new terminals.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scrollbackLines !== DEFAULT_SCROLLBACK_LINES && (
              <ResetButton onReset={() => setScrollbackLines(DEFAULT_SCROLLBACK_LINES)} />
            )}
            {scrollbackLines !== DEFAULT_SCROLLBACK_LINES && <DirtyDot />}
            <FormSelect
              className="w-44 shrink-0"
              value={String(scrollbackLines)}
              options={scrollbackOptions}
              onChange={(value) => setScrollbackLines(Number(value))}
            />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[var(--t-text-primary)]">Scroll minimap</div>
            <div className="text-xs mt-1 text-[var(--t-text-dim)]">
              Show a miniature scrollback overview beside terminals.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default && (
              <ResetButton onReset={() => setScrollMinimapEnabled(TOGGLE_DEFS["scroll-minimap"].default)} />
            )}
            {scrollMinimapEnabled !== TOGGLE_DEFS["scroll-minimap"].default && <DirtyDot />}
            <Toggle checked={scrollMinimapEnabled} onChange={setScrollMinimapEnabled} />
          </div>
        </div>
        <div className="group mt-4 rounded-xl bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[var(--t-text-primary)]">Select to copy</div>
            <div className="text-xs mt-1 text-[var(--t-text-dim)]">
              Show a copy button when text is selected in a terminal.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {selectToCopy !== TOGGLE_DEFS["select-to-copy"].default && (
              <ResetButton onReset={() => setSelectToCopy(TOGGLE_DEFS["select-to-copy"].default)} />
            )}
            {selectToCopy !== TOGGLE_DEFS["select-to-copy"].default && <DirtyDot />}
            <Toggle checked={selectToCopy} onChange={setSelectToCopy} />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
            Color Theme
          </h3>
          <div className="flex gap-1">
            <button
              onClick={() => openThemeImportExport("import")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-elevated)]"
              title="Import theme(s)"
            >
              <Icon icon="lucide:download" width={12} />
              Import
            </button>
            {customThemes.length > 0 && (
              <button
                onClick={() => openThemeImportExport("export")}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-elevated)]"
                title="Export all custom themes"
              >
                <Icon icon="lucide:upload" width={12} />
                Export All
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          {allThemes.map((theme) => {
            const isActive = theme.id === activeThemeId;
            return (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                className="group relative flex flex-col gap-2.5 p-3 rounded-xl text-left transition-all"
                style={{
                  background: isActive ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
                  border: `1.5px solid ${isActive ? "var(--t-accent)" : "var(--t-border)"}`,
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border-hover)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)"; }}
              >
                {isActive && (
                  <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center bg-[var(--t-accent)]">
                    <Icon icon="lucide:check" width={9} className="text-white" />
                  </span>
                )}
                <div className="flex gap-1.5">
                  {[theme.ui.bgTerminal, theme.ui.accent, theme.ui.tabActiveText, theme.ui.statusConnected].map((color, i) => (
                    <span key={i} className="w-5 h-5 rounded-md shrink-0" style={{ background: color, border: "1px solid rgba(255,255,255,0.08)" }} />
                  ))}
                </div>
                <span className="text-xs font-medium leading-tight" style={{ color: isActive ? "var(--t-text-bright)" : "var(--t-text-primary)" }}>
                  {theme.name}
                </span>
                {!theme.builtIn && (
                  <div className="absolute bottom-2 right-2 flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); exportTheme(theme); }}
                      className="p-1 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-[var(--t-text-muted)]"
                      title="Export theme"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
                    >
                      <Icon icon="lucide:share" width={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openThemeCreator(theme.id); }}
                      className="p-1 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-[var(--t-text-muted)]"
                      title="Edit theme"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
                    >
                      <Icon icon="lucide:pencil" width={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(theme.id); }}
                      className="p-1 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-[var(--t-status-error)]"
                      title="Delete theme"
                    >
                      <Icon icon="lucide:trash-2" width={11} />
                    </button>
                  </div>
                )}
              </button>
            );
          })}

          <button
            onClick={() => openThemeCreator()}
            className="flex flex-col gap-2.5 p-3 rounded-xl text-left transition-all text-[var(--t-text-muted)]"
            style={{ background: "var(--t-bg-card)", border: "1.5px dashed var(--t-border)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          >
            <div className="h-5 flex items-center">
              <Icon icon="lucide:plus" width={14} />
            </div>
            <span className="text-xs font-medium leading-tight">New Custom Theme</span>
          </button>
        </div>
      </div>
    </div>
  );
}
