import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { ToolbarViewControls, type LayoutMode, type SortMode } from "@/components/shared/ToolbarViewControls";
import { ToolbarDropdown } from "@/components/shared/ToolbarDropdown";
import { useToolbarResize } from "@/hooks/useToolbarResize";
import { useRipple } from "@/hooks/useRipple";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useUIContributions } from "@/hooks/useUIContributions";

interface ShellOption {
  name: string;
  path: string;
}

interface HomeToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onCreateHost: () => void;
  onCreateFolder: () => void;
  canCreate?: boolean;
  canCreateFolder?: boolean;
  onOpenLocalTerminal: () => void;
  onOpenSerial: () => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (value: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (value: SortMode) => void;
  availableTags?: string[];
  tagCounts?: Record<string, number>;
  tagFilter?: string[];
  onTagFilterChange?: (tags: string[]) => void;
  onRenameTag?: (oldName: string, newName: string) => Promise<void>;
  onDeleteTag?: (name: string) => Promise<void>;
}

export function HomeToolbar({
  search,
  onSearchChange,
  onCreateHost,
  onCreateFolder,
  onOpenLocalTerminal,
  onOpenSerial,
  canCreate = true,
  canCreateFolder = true,
  layoutMode,
  onLayoutModeChange,
  sortMode,
  onSortModeChange,
  availableTags,
  tagCounts,
  tagFilter,
  onTagFilterChange,
  onRenameTag,
  onDeleteTag,
}: HomeToolbarProps) {
  const { compact, rowRef, leftRef, rightRef } = useToolbarResize();
  const { createRipple: rippleHost, rippleEls: ripplesHost } = useRipple();
  const { createRipple: rippleChevron, rippleEls: ripplesChevron } = useRipple();
  const { createRipple: rippleSerial, rippleEls: ripplesSerial } = useRipple();
  const [hostMenuOpen, setHostMenuOpen] = useState(false);
  const hostMenuRef = useRef<HTMLDivElement>(null);
  const hostMenuItems = useUIContributions("home.toolbar.hostMenu");

  useEffect(() => {
    if (!hostMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (hostMenuRef.current && !hostMenuRef.current.contains(e.target as Node)) setHostMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [hostMenuOpen]);

  const [shells, setShells] = useState<ShellOption[]>([]);
  const { preferredShell, setPreferredShell } = useTerminalSettingsStore();

  useEffect(() => {
    invoke<ShellOption[]>("local_list_shells").then(setShells).catch(() => {});
  }, []);

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-2 px-5 py-2.5 bg-[var(--t-bg-sidebar)] border-b border-b-[var(--t-bg-terminal)]">
        <div ref={leftRef} className="flex items-center gap-2 shrink-0">
          <div className="relative flex items-center gap-px" ref={hostMenuRef}>
            <button
              onClick={onCreateHost}
              onMouseDown={rippleHost}
              disabled={!canCreate}
              title={compact ? "New Host" : undefined}
              className="flex items-center gap-2 px-3 h-8 text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap bg-[var(--t-bg-input)] text-[var(--t-text-primary)] relative overflow-hidden rounded-tl-[0.533rem] rounded-bl-[0.533rem]"
              onMouseEnter={(e) => { if (canCreate) e.currentTarget.style.background = "var(--t-bg-input-hover)"; }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
              style={{ opacity: canCreate ? 1 : 0.4, cursor: canCreate ? "pointer" : "not-allowed" }}
              type="button"
            >
              {ripplesHost}
              <Icon icon="lucide:server" width={18} />
              {!compact && "NEW HOST"}
            </button>
            <>
              <button
                onMouseDown={rippleChevron}
                onClick={() => setHostMenuOpen((o) => !o)}
                className="flex items-center justify-center w-8 h-8 transition-colors bg-[var(--t-bg-input)] relative overflow-hidden rounded-tr-[0.533rem] rounded-br-[0.533rem]"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
                type="button"
                aria-label="New host options"
              >
                {ripplesChevron}
                <span className="[&_path]:[stroke-width:3]">
                  <Icon icon="lucide:chevron-down" width={20} color="white" />
                </span>
              </button>
              {hostMenuOpen && (
                <div
                  className="absolute top-full left-0 mt-1 p-1.5 rounded-xl flex flex-col z-50 bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)] min-w-[12.667rem]"
                  style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
                >
                  {canCreateFolder && (
                    <button
                      onClick={() => { onCreateFolder(); setHostMenuOpen(false); }}
                      className="flex items-center gap-2.5 p-3 rounded-lg text-sm font-medium transition-colors text-left text-[var(--t-text-secondary)]"
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-secondary)"; }}
                    >
                      <Icon icon="lucide:folder-plus" width={15} />
                      New Folder
                    </button>
                  )}
                  {hostMenuItems.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { item.onClick(); setHostMenuOpen(false); }}
                      className="flex items-center gap-2.5 p-3 rounded-lg text-sm font-medium transition-colors text-left text-[var(--t-text-secondary)]"
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-secondary)"; }}
                    >
                      {item.icon && <Icon icon={item.icon} width={15} />}
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          </div>

          <ToolbarDropdown
            icon="lucide:terminal"
            label={compact ? undefined : "TERMINAL"}
            value={preferredShell ?? shells[0]?.path ?? ""}
            options={shells.map((s) => ({ value: s.path, label: s.name }))}
            menuWidth={200}
            align="left"
            onAction={onOpenLocalTerminal}
            onChange={setPreferredShell}
          />

          <button
            className="flex items-center gap-2 px-3 py-2 h-8 rounded-lg text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap bg-[var(--t-bg-input)] text-[var(--t-text-primary)] border border-[var(--t-border-hover)] relative overflow-hidden"
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
            onMouseDown={rippleSerial}
            onClick={onOpenSerial}
            title="Open serial console"
            type="button"
          >
            {ripplesSerial}
            <Icon icon="lucide:ethernet-port" width={20} />
            {!compact && "SERIAL"}
          </button>
        </div>

        <div ref={rightRef} className="ml-auto flex">
          <ToolbarViewControls
            search={search}
            onSearchChange={onSearchChange}
            filterPlaceholder="Filter hosts..."
            filterWidth={176}
            layoutMode={layoutMode}
            onLayoutModeChange={onLayoutModeChange}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
            availableTags={availableTags}
            tagCounts={tagCounts}
            tagFilter={tagFilter}
            onTagFilterChange={onTagFilterChange}
            onRenameTag={onRenameTag}
            onDeleteTag={onDeleteTag}
          />
        </div>
      </div>
    </>
  );
}
