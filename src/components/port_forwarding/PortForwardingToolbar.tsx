import { Icon } from "@iconify/react";
import { ToolbarViewControls, type LayoutMode, type SortMode } from "@/components/shared/ToolbarViewControls";
import { ToolbarDropdown } from "@/components/shared/ToolbarDropdown";
import { useToolbarResize } from "@/hooks/useToolbarResize";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (v: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  onNewRule?: () => void;
  onNewFolder?: () => void;
  selectedCount?: number;
  onDeleteSelected?: () => void;
}

export function PortForwardingToolbar({
  search, onSearchChange,
  layoutMode, onLayoutModeChange,
  sortMode, onSortModeChange,
  onNewRule, onNewFolder,
  selectedCount = 0,
  onDeleteSelected,
}: Props) {
  const { compact, rowRef, leftRef, rightRef } = useToolbarResize();

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-2 px-5 py-2.5 shrink-0 bg-(--t-bg-toolbar) border-b border-b-(--t-border)">
        <div ref={leftRef} className="flex items-center">
          <ToolbarViewControls
            search={search}
            onSearchChange={onSearchChange}
            filterPlaceholder="Filter rules…"
            filterShortcutId="filter"
            filterWidth={176}
            layoutMode={layoutMode}
            onLayoutModeChange={onLayoutModeChange}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
          />
        </div>

        <div ref={rightRef} className="flex items-center gap-2 ml-auto shrink-0">
          {selectedCount > 0 && onDeleteSelected && (
            <button
              onClick={onDeleteSelected}
              title="Delete selected"
              className="flex items-center gap-2 px-3 h-8 rounded-lg text-sm font-bold tracking-wider transition-colors bg-status-error/10 text-status-error border border-status-error/20 hover:bg-status-error/20"
              type="button"
            >
              <Icon icon="lucide:trash-2" width={15} />
              {!compact && (
                <span>
                  DELETE{" "}
                  <span className="opacity-70">({selectedCount})</span>
                </span>
              )}
            </button>
          )}
          <ToolbarDropdown
            icon="lucide:plus"
            label={compact ? undefined : "New Rule"}
            onAction={onNewRule ?? (() => {})}
            items={onNewFolder ? [{ label: "New Folder", icon: "lucide:folder-plus", onClick: onNewFolder }] : []}
            disabled={!onNewRule}
            variant="accent"
            align="right"
            menuWidth={160}
          />
        </div>
      </div>
    </>
  );
}
