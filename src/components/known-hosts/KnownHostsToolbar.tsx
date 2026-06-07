import { Icon } from "@iconify/react";
import { ToolbarViewControls, type LayoutMode, type SortMode } from "@/components/shared/ToolbarViewControls";
import { useToolbarResize } from "@/hooks/useToolbarResize";

interface KnownHostsToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (v: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  selectedCount: number;
  onDeleteSelected?: () => void;
}

export function KnownHostsToolbar({
  search,
  onSearchChange,
  layoutMode,
  onLayoutModeChange,
  sortMode,
  onSortModeChange,
  selectedCount,
  onDeleteSelected,
}: KnownHostsToolbarProps) {
  const { compact, rowRef, leftRef, rightRef } = useToolbarResize();

  return (
    <>
      <div
        ref={rowRef}
        className="flex items-center gap-2 px-5 py-2.5 shrink-0 chrome-toolbar"
      >
        <div ref={leftRef} className="flex items-center">
          <ToolbarViewControls
            search={search}
            onSearchChange={onSearchChange}
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
        </div>
      </div>
    </>
  );
}
