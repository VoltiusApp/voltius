import { Icon } from "@iconify/react";
import { ToolbarViewControls, type LayoutMode, type SortMode } from "@/components/shared/ToolbarViewControls";
import { useToolbarResize } from "@/hooks/useToolbarResize";
import { useRipple } from "@/hooks/useRipple";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (v: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  onNewRule?: () => void;
}

export function PortForwardingToolbar({
  search, onSearchChange,
  layoutMode, onLayoutModeChange,
  sortMode, onSortModeChange,
  onNewRule,
}: Props) {
  const { compact, rowRef, leftRef, rightRef } = useToolbarResize();
  const { createRipple, rippleEls } = useRipple();

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-2 px-5 py-2.5 shrink-0 bg-[var(--t-bg-sidebar)] border-b border-b-[var(--t-bg-terminal)]">
        <div ref={leftRef} className="flex items-center gap-2 shrink-0">
          <button
            onClick={onNewRule}
            onMouseDown={createRipple}
            disabled={!onNewRule}
            title={compact ? "New Rule" : undefined}
            className="flex items-center gap-2 px-3 h-8 rounded-lg text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap bg-[var(--t-bg-input)] text-[var(--t-text-primary)] relative overflow-hidden"
            style={{ opacity: !onNewRule ? 0.35 : undefined, cursor: !onNewRule ? "default" : undefined }}
            onMouseEnter={(e) => { if (onNewRule) e.currentTarget.style.background = "var(--t-bg-input-hover)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
            type="button"
          >
            {rippleEls}
            <Icon icon="lucide:plus" width={16} />
            {!compact && "NEW RULE"}
          </button>
        </div>

        <div ref={rightRef} className="ml-auto flex">
          <ToolbarViewControls
            search={search}
            onSearchChange={onSearchChange}
            filterPlaceholder="Filter rules…"
            layoutMode={layoutMode}
            onLayoutModeChange={onLayoutModeChange}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
          />
        </div>
      </div>
    </>
  );
}
